/**
 * server.js — Personal Health OS
 * Node.js + Express backend with all API routes and CRON jobs
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const path = require('path');

const db = require('./db');
const jarvis = require('./jarvis');
const { calcReadinessScore, calcTrainingLoad, calcBiologicalAge } = jarvis;
const { runLagAnalysis, getScatterData, getWeeklyStats } = require('./correlations');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Health Auto Export Ingestion ──────────────────────────────────────────────

// Track last successful watch push — initialised from DB so container restarts don't lose state
let lastHealthPush = null;
let watchAlertSentAt = null; // prevent alert spam — only re-alert every 2h

function initWatchMonitor() {
  try {
    const d = db.getDb();
    // Try persisted value first (survives restarts)
    const persisted = d.prepare(`SELECT value FROM settings WHERE key = 'last_health_push'`).get();
    if (persisted?.value) {
      lastHealthPush = parseInt(persisted.value);
      console.log(`[WATCH] Last known push: ${new Date(lastHealthPush).toISOString()}`);
    } else {
      // Fallback: use HRV created_at
      const latest = d.prepare(`SELECT MAX(created_at) as ts FROM hrv`).get();
      if (latest?.ts) {
        lastHealthPush = new Date(latest.ts).getTime();
        console.log(`[WATCH] Last known push (from HRV): ${latest.ts}`);
      }
    }
  } catch (e) { console.error('[WATCH] initWatchMonitor error:', e.message); }
}

app.post('/api/health', (req, res) => {
  try {
    const payload = req.body;
    const results = { ingested: [], unmatched: [] };
    const database = db.getDb();

    // Debug: log all top-level metric names received
    const topMetrics = payload?.data?.metrics || payload?.metrics || (Array.isArray(payload) ? payload : []);
    const receivedNames = topMetrics.map(m => m.name || m.type || '?');
    if (receivedNames.length > 0) {
      console.log('[HEALTH] Received metrics:', receivedNames.join(', '));
    }

    // ── Detect payload type ──────────────────────────────────────────────────
    // Health Metrics:  { data: { metrics: [...] } }
    // Workouts:        { data: { workouts: [...] } }
    // State of Mind:   { data: { symptoms: [...] } }  OR { data: { stateOfMind: [...] } }
    // v1 fallback:     array at root or { metrics: [...] }

    let metrics = [];

    // Handle Workouts-only payload (Workouts automation)
    if (payload.data && Array.isArray(payload.data.workouts) && !payload.data.metrics) {
      for (const w of payload.data.workouts) {
        try {
          ingestWorkout(database, w);
          results.ingested.push('workout');
        } catch (e) { console.error('Workout ingest error:', e.message); }
      }
    }
    // Handle State of Mind payload
    else if (payload.data && (Array.isArray(payload.data.symptoms) || Array.isArray(payload.data.stateOfMind))) {
      const entries = payload.data.symptoms || payload.data.stateOfMind || [];
      for (const s of entries) {
        try {
          ingestStateOfMind(database, s);
          results.ingested.push('state_of_mind');
        } catch (e) { console.error('State of mind ingest error:', e.message); }
      }
    }
    // Standard Health Metrics payload (v2)
    else if (payload.data && Array.isArray(payload.data.metrics)) {
      metrics = payload.data.metrics;
      // v2 can also bundle workouts alongside metrics
      if (Array.isArray(payload.data.workouts)) {
        for (const w of payload.data.workouts) {
          try { ingestWorkout(database, w); results.ingested.push('workout'); } catch (e) { /* skip */ }
        }
      }
    }
    // v1 array at root
    else if (Array.isArray(payload)) {
      metrics = payload;
    }
    // { metrics: [...] }
    else if (Array.isArray(payload.metrics)) {
      metrics = payload.metrics;
    }
    // single object fallback
    else if (payload.name || payload.type) {
      metrics = [payload];
    }

    for (const rawMetric of metrics) {
      // v2: each metric has a .data[] array of readings — expand into individual points
      const readings = expandMetric(rawMetric);
      for (const metric of readings) {
      const type = metric.name || metric.type || metric.identifier || '';
      const t = type.toLowerCase().replace(/[^a-z0-9]/g, '_');

      if (!type) continue;

      try {
        if (t === 'heart_rate' || t === 'heartrate' || type === 'HeartRate') {
          ingestHeartRate(database, metric);
          results.ingested.push('heart_rate');
        } else if (t === 'heart_rate_variability_sdnn' || t === 'heart_rate_variability' || t === 'hrv' || t === 'heartratevariabilitysdnn' || t === 'heartratevariability' || type === 'HeartRateVariabilitySDNN') {
          ingestHRV(database, metric);
          results.ingested.push('hrv');
        } else if (t === 'sleep_analysis' || t === 'sleep' || t === 'sleepanalysis' || type === 'SleepAnalysis') {
          ingestSleep(database, metric);
          results.ingested.push('sleep');
        } else if (t === 'step_count' || t === 'steps' || t === 'stepcount' || type === 'StepCount') {
          ingestActivity(database, metric, 'steps');
          results.ingested.push('steps');
        } else if (t === 'active_energy_burned' || t === 'active_energy' || t === 'active_calories' || t === 'activeenergyburned' || type === 'ActiveEnergyBurned') {
          ingestActivity(database, metric, 'active_calories');
          results.ingested.push('active_calories');
        } else if (t === 'exercise_time' || t === 'apple_exercise_time' || t === 'exercise_minutes' || t === 'exercisetime' || t === 'appleexercisetime' || type === 'ExerciseTime' || type === 'AppleExerciseTime') {
          ingestActivity(database, metric, 'exercise_minutes');
          results.ingested.push('exercise_minutes');
        } else if (t === 'oxygen_saturation' || t === 'blood_oxygen_saturation' || t === 'spo2' || t === 'oxygensaturation' || t === 'bloodoxygensaturation' || type === 'OxygenSaturation' || type === 'BloodOxygenSaturation') {
          ingestSpO2(database, metric);
          results.ingested.push('spo2');
        } else if (t === 'apple_sleeping_wrist_temperature' || t === 'wrist_temperature' || t === 'applesleepingwristtemperature' || type === 'AppleSleepingWristTemperature') {
          ingestTemperature(database, metric);
          results.ingested.push('temperature');
        } else if (t === 'vo2_max' || t === 'vo2max' || type === 'VO2Max') {
          ingestVO2Max(database, metric);
          results.ingested.push('vo2max');
        } else if (t === 'resting_heart_rate' || t === 'restingheartrate' || type === 'RestingHeartRate') {
          ingestRestingHR(database, metric);
          results.ingested.push('resting_hr');
        } else if (t === 'workout' || type === 'Workout') {
          ingestWorkout(database, metric);
          results.ingested.push('workout');
        } else if (t === 'mindful_session' || t === 'state_of_mind' || t === 'mindfulsession' || type === 'MindfulSession') {
          ingestStateOfMind(database, metric);
          results.ingested.push('state_of_mind');
        } else if (t === 'respiratory_rate' || t === 'respiratoryrate' || type === 'RespiratoryRate') {
          ingestRespiratoryRate(database, metric);
          results.ingested.push('respiratory_rate');
        } else if (t === 'flights_climbed' || t === 'flightsclimbed' || type === 'FlightsClimbed') {
          ingestActivity(database, metric, 'flights');
          results.ingested.push('flights');
        } else if (t === 'apple_stand_hour' || t === 'stand_hour' || t === 'applestandhour' || type === 'AppleStandHour') {
          ingestActivity(database, metric, 'stand_hours');
          results.ingested.push('stand_hours');
        } else if (t === 'distance_walking_running' || t === 'walking_running_distance' || t === 'distancewalkingrunning' || t === 'walkingrunningdistance' || type === 'DistanceWalkingRunning') {
          ingestActivity(database, metric, 'distance');
          results.ingested.push('distance');
        } else if (t === 'body_mass' || t === 'weight' || t === 'bodymass' || type === 'BodyMass') {
          ingestBodyComp(database, metric, 'weight_kg');
          results.ingested.push('weight');
        } else if (t === 'body_fat_percentage' || t === 'bodyfatpercentage' || type === 'BodyFatPercentage') {
          ingestBodyComp(database, metric, 'body_fat_pct');
          results.ingested.push('body_fat');
        } else {
          // Only log unique unmatched names
          if (!results.unmatched.includes(type)) {
            results.unmatched.push(type);
            console.log('[HEALTH] Unmatched metric:', type, '→ normalised:', t);
          }
        }
      } catch (e) {
        console.error(`Error ingesting ${type}:`, e.message);
      }
      } // end readings loop
    } // end metrics loop

    res.json({ ok: true, ingested: [...new Set(results.ingested)], unmatched: [...new Set(results.unmatched)] });

    // Record push time — check if we need to send a reconnect message
    const wasStale = watchAlertSentAt && (Date.now() - lastHealthPush > 65 * 60 * 1000);
    lastHealthPush = Date.now();
    // Persist so it survives container restarts
    try { database.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('last_health_push', ?)`).run(String(lastHealthPush)); } catch(_) {}
    if (wasStale) {
      watchAlertSentAt = null;
      const chatIds = getTelegramChatIds();
      for (const chat_id of chatIds) {
        tgSend(chat_id, `✅ *Watch reconnected* — data flowing again.`);
      }
      console.log('[WATCH] Reconnected after stale period.');
    }
  } catch (e) {
    console.error('Ingestion error:', e);
    res.status(500).json({ error: e.message });
  }
});

function getDateStr(metric) {
  const ts = metric.startDate || metric.date || metric.timestamp || new Date().toISOString();
  // v2 dates look like "2026-03-31 08:00:00 +0000" — normalise to ISO
  return String(ts).replace(' ', 'T').slice(0, 10);
}

function getTimestamp(metric) {
  const ts = metric.startDate || metric.date || metric.timestamp || new Date().toISOString();
  return String(ts).replace(' ', 'T');
}

function getValue(metric) {
  // v2: Avg/Min/Max fields, v1: value/qty/average
  return parseFloat(metric.Avg || metric.avg || metric.value || metric.qty || metric.average || 0);
}


// Expand a v2 metric (which has a data[] array) into flat individual reading objects
function expandMetric(metric) {
  if (!Array.isArray(metric.data) || metric.data.length === 0) {
    return [metric];
  }
  return metric.data.map(pt => ({
    ...pt,
    name: metric.name,
    units: metric.units,
    // map qty/Avg into consistent value fields
    value: pt.Avg || pt.avg || pt.qty || pt.value || 0,
    qty:   pt.qty || pt.Avg || pt.avg || pt.value || 0,
    average: pt.Avg || pt.avg || pt.qty || 0,
    startDate: pt.date || pt.startDate,
    date: pt.date || pt.startDate,
  }));
}

function ingestHeartRate(db, metric) {
  const date = getDateStr(metric);
  const hour = new Date(getTimestamp(metric)).getHours();
  const val = getValue(metric);
  const existing = db.prepare('SELECT id, hr_min, hr_max, hr_avg FROM vitals WHERE date = ? AND hour = ?').get(date, hour);
  if (existing) {
    db.prepare(`UPDATE vitals SET hr_min = MIN(hr_min, ?), hr_max = MAX(hr_max, ?), hr_avg = (hr_avg + ?) / 2 WHERE id = ?`)
      .run(val, val, val, existing.id);
  } else {
    db.prepare('INSERT INTO vitals (date, hour, hr_min, hr_avg, hr_max) VALUES (?, ?, ?, ?, ?)').run(date, hour, val, val, val);
  }
}

function ingestRestingHR(db, metric) {
  const date = getDateStr(metric);
  const val = getValue(metric);
  if (!val || val <= 0) return;
  const existing = db.prepare('SELECT id, resting_hr FROM vitals WHERE date = ?').get(date);
  if (existing) {
    if (!existing.resting_hr || val < existing.resting_hr) {
      db.prepare('UPDATE vitals SET resting_hr = ? WHERE id = ?').run(val, existing.id);
    }
  } else {
    db.prepare('INSERT INTO vitals (date, resting_hr) VALUES (?, ?)').run(date, val);
  }
}

function ingestHRV(db, metric) {
  const ts = getTimestamp(metric);
  const val = getValue(metric);
  if (!val || val <= 0) return;
  // Normalise to first 16 chars (YYYY-MM-DDTHH:MM) for dedup — prevents double-insert
  // when same reading arrives with different timezone formatting (T vs space, +00:00 vs +0000)
  const tsNorm = ts.replace(' ', 'T').slice(0, 16);
  const existing = db.prepare('SELECT id FROM hrv WHERE replace(substr(timestamp,1,16)," ","T") = ?').get(tsNorm);
  if (!existing) {
    db.prepare('INSERT INTO hrv (timestamp, rmssd) VALUES (?, ?)').run(ts, val);
  }
}

function ingestSleep(db, metric) {
  // ── Format A: summary object with sleepStart/sleepEnd (old Health Auto Export) ──
  if (metric.sleepStart && metric.sleepEnd) {
    const date = metric.sleepEnd.slice(0, 10);
    const totalMin = Math.round((new Date(metric.sleepEnd) - new Date(metric.sleepStart)) / 60000);
    const deep = metric.deepSleepDuration || 0;
    const rem = metric.remSleepDuration || 0;
    const core = metric.coreSleepDuration || 0;
    const awake = metric.awakeDuration || 0;
    const efficiency = totalMin > 0 ? Math.round(((totalMin - awake) / totalMin) * 100) : null;

    db.prepare(`INSERT INTO sleep (date, start_time, end_time, total_minutes, deep_minutes, rem_minutes, core_minutes, awake_minutes, efficiency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET start_time=excluded.start_time, end_time=excluded.end_time,
      total_minutes=excluded.total_minutes, deep_minutes=excluded.deep_minutes, rem_minutes=excluded.rem_minutes,
      core_minutes=excluded.core_minutes, awake_minutes=excluded.awake_minutes, efficiency=excluded.efficiency`
    ).run(date, metric.sleepStart, metric.sleepEnd, totalMin, deep, rem, core, awake, efficiency);

    if (metric.stages && Array.isArray(metric.stages)) {
      for (const stage of metric.stages) {
        const dur = Math.round((new Date(stage.endDate) - new Date(stage.startDate)) / 60000);
        db.prepare('INSERT OR IGNORE INTO sleep_stages (date, stage, start_time, end_time, duration_minutes) VALUES (?, ?, ?, ?, ?)')
          .run(date, stage.stage, stage.startDate, stage.endDate, dur);
      }
    }
    return;
  }

  // ── Format B: individual interval with startDate + endDate + value (Health Auto Export v2) ──
  // Each data point is one sleep stage interval. Called once per interval.
  const startStr = metric.startDate || metric.start_date;
  const endStr = metric.endDate || metric.end_date;
  const stageValue = String(metric.value || metric.stage || '');

  if (!startStr || !endStr || !stageValue) return;

  // Parse timestamps — handle "2026-03-31 07:30:00 +0100" style
  const parseTs = ts => new Date(String(ts).replace(/\s([+-]\d{2}):?(\d{2})$/, '$1:$2').replace(' ', 'T'));
  const startDate = parseTs(startStr);
  const endDate = parseTs(endStr);
  if (isNaN(startDate) || isNaN(endDate)) return;

  const durationMin = Math.round((endDate - startDate) / 60000);
  if (durationMin <= 0) return;

  // Night date = date of end time (handles midnight crossover)
  const nightDate = endStr.slice(0, 10);

  // Map Apple Health sleep stage string → column
  const sl = stageValue.toLowerCase();
  let stageCol = null;
  if (sl.includes('deep')) stageCol = 'deep_minutes';
  else if (sl.includes('rem')) stageCol = 'rem_minutes';
  else if (sl.includes('core')) stageCol = 'core_minutes';
  else if (sl.includes('awake')) stageCol = 'awake_minutes';
  else if (sl.includes('inbed')) stageCol = 'awake_minutes'; // InBed but not asleep
  else if (sl.includes('asleep')) stageCol = 'core_minutes'; // generic asleep → core

  const isAwakeStage = stageCol === 'awake_minutes';

  const existing = db.prepare('SELECT * FROM sleep WHERE date = ?').get(nightDate);

  if (existing) {
    const updates = [];
    const params = [];
    // Track earliest start
    if (!existing.start_time || startStr < existing.start_time) {
      updates.push('start_time = ?'); params.push(startStr);
    }
    // Track latest end
    if (!existing.end_time || endStr > existing.end_time) {
      updates.push('end_time = ?'); params.push(endStr);
    }
    // Add to stage column
    if (stageCol) {
      updates.push(`${stageCol} = COALESCE(${stageCol}, 0) + ?`);
      params.push(durationMin);
    }
    // Only count non-awake time toward total
    if (stageCol && !isAwakeStage) {
      updates.push('total_minutes = COALESCE(total_minutes, 0) + ?');
      params.push(durationMin);
    }
    if (updates.length > 0) {
      params.push(nightDate);
      db.prepare(`UPDATE sleep SET ${updates.join(', ')} WHERE date = ?`).run(...params);
    }
    // Recalculate efficiency
    const updated = db.prepare('SELECT total_minutes, awake_minutes FROM sleep WHERE date = ?').get(nightDate);
    if (updated && updated.total_minutes > 0) {
      const eff = Math.round(((updated.total_minutes) / (updated.total_minutes + (updated.awake_minutes || 0))) * 100);
      db.prepare('UPDATE sleep SET efficiency = ? WHERE date = ?').run(eff, nightDate);
    }
  } else {
    db.prepare(`INSERT INTO sleep (date, start_time, end_time, total_minutes, deep_minutes, rem_minutes, core_minutes, awake_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        nightDate, startStr, endStr,
        isAwakeStage ? 0 : durationMin,
        stageCol === 'deep_minutes' ? durationMin : 0,
        stageCol === 'rem_minutes' ? durationMin : 0,
        stageCol === 'core_minutes' ? durationMin : 0,
        stageCol === 'awake_minutes' ? durationMin : 0
      );
  }

  // Store individual stage segment
  if (stageCol) {
    const stageNameMap = { deep_minutes: 'Deep', rem_minutes: 'REM', core_minutes: 'Core', awake_minutes: 'Awake' };
    try {
      db.prepare('INSERT OR IGNORE INTO sleep_stages (date, stage, start_time, end_time, duration_minutes) VALUES (?, ?, ?, ?, ?)')
        .run(nightDate, stageNameMap[stageCol] || 'Unknown', startStr, endStr, durationMin);
    } catch {}
  }
}

function ingestActivity(db, metric, field) {
  const date = getDateStr(metric);
  const startTs = getTimestamp(metric);
  let rawVal = getValue(metric);
  const colMap = {
    steps: 'steps',
    active_calories: 'active_calories',
    exercise_minutes: 'exercise_minutes',
    flights: 'flights_climbed',
    distance: 'distance_km',
    stand_hours: 'stand_hours',
  };
  const col = colMap[field];
  if (!col) return;

  // Convert kJ → kcal if needed (Health Auto Export sometimes sends energy in kJ)
  if (field === 'active_calories' && (metric.units === 'kJ' || metric.unit === 'kJ')) {
    rawVal = rawVal / 4.184;
  }

  const val = (field === 'steps' || field === 'exercise_minutes' || field === 'flights' || field === 'stand_hours')
    ? Math.round(rawVal) : rawVal;

  // Deduplicate per (field, start_ts) — prevents re-export accumulation
  const inserted = db.prepare('INSERT OR IGNORE INTO activity_raw (date, field, start_ts, value) VALUES (?, ?, ?, ?)')
    .run(date, field, startTs, val);

  if (inserted.changes === 0) return; // already processed this exact reading

  // Recalculate daily total from all raw readings for this (date, field)
  const total = db.prepare('SELECT SUM(value) as t FROM activity_raw WHERE date = ? AND field = ?').get(date, field)?.t || 0;
  db.prepare(`INSERT INTO activity (date, ${col}) VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET ${col} = ?, created_at = CURRENT_TIMESTAMP`).run(date, total, total);
}

function ingestSpO2(db, metric) {
  const ts = getTimestamp(metric);
  const val = getValue(metric);
  if (!val) return;
  db.prepare('INSERT OR IGNORE INTO spo2 (date, timestamp, value) VALUES (?, ?, ?)').run(getDateStr(metric), ts, val);
}

function ingestTemperature(db, metric) {
  const date = getDateStr(metric);
  const val = getValue(metric);
  db.prepare('INSERT OR REPLACE INTO temperature (date, deviation) VALUES (?, ?)').run(date, val);
}

function ingestVO2Max(db, metric) {
  const date = getDateStr(metric);
  const val = getValue(metric);
  if (!val) return;
  db.prepare(`UPDATE vitals SET vo2max = ? WHERE date = ?`).run(val, date);
  db.prepare(`INSERT INTO vitals (date, vo2max) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM vitals WHERE date = ?)`).run(date, val, date);
}

function ingestRespiratoryRate(db, metric) {
  const date = getDateStr(metric);
  const val = getValue(metric);
  if (!val) return;
  db.prepare(`UPDATE vitals SET respiratory_rate = ? WHERE date = ?`).run(val, date);
}

function ingestWorkout(db, metric) {
  // v2 workout fields: name, start, end, duration (seconds), activeEnergy, distance
  // v1 fields: workoutType, totalEnergyBurned, totalDistance, averageHeartRate
  const date = getDateStr({ date: metric.start || metric.startDate || metric.date });
  const type = metric.name || metric.workoutType || metric.type || 'Other';
  const durationMins = parseFloat(metric.duration || 0) / 60 || parseFloat(metric.durationMinutes || 0);
  const calories = parseFloat(metric.activeEnergy || metric.totalEnergyBurned || metric.calories || 0);
  const distanceKm = parseFloat(metric.distance || metric.totalDistance || 0) / 1000 ||
                     parseFloat(metric.distanceKm || 0);
  const avgHR = parseFloat(metric.avgHeartRate || metric.averageHeartRate || 0);
  const maxHR = parseFloat(metric.maxHeartRate || 0);

  if (!date || date === 'Invalid') return;
  const existing = db.prepare('SELECT id FROM workouts WHERE date = ? AND type = ?').get(date, type);
  if (!existing) {
    db.prepare('INSERT INTO workouts (date, type, duration_minutes, calories, distance_km, avg_hr, max_hr) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(date, type, durationMins, calories, distanceKm, avgHR, maxHR);
  }
}

function ingestStateOfMind(db, metric) {
  const ts = getTimestamp(metric);
  const date = getDateStr(metric);
  const tsNorm = ts.replace(' ', 'T').slice(0, 16);
  // Deduplicate — same Apple Health entry arrives on every export
  const existing = db.prepare('SELECT id FROM state_of_mind WHERE replace(substr(timestamp,1,16)," ","T") = ?').get(tsNorm);
  if (existing) return;
  db.prepare('INSERT INTO state_of_mind (timestamp, date, valence, labels, associations) VALUES (?, ?, ?, ?, ?)')
    .run(ts, date, metric.valence || null, JSON.stringify(metric.labels || []), JSON.stringify(metric.associations || []));
}

// ─── Dashboard APIs ─────────────────────────────────────────────────────────

app.get('/api/dashboard', (req, res) => {
  try {
    const database = db.getDb();
    const snapshot = db.getDashboardSnapshot();
    const score = db.getSuperhermanScore();
    const anomalies = jarvis.checkAnomalies(database);

    // Enrich snapshot with new superhuman metrics
    snapshot.readiness = calcReadinessScore(database);
    snapshot.training_load = calcTrainingLoad(database);
    snapshot.bio_age = calcBiologicalAge(database);

    res.json({ snapshot, score, anomalies });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Separate lightweight endpoints for individual modules
app.get('/api/readiness', (req, res) => {
  try { res.json(calcReadinessScore(db.getDb())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/training-load', (req, res) => {
  try { res.json(calcTrainingLoad(db.getDb())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bio-age', (req, res) => {
  try { res.json(calcBiologicalAge(db.getDb())); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Health check endpoint (Docker)
app.get('/api/snapshot', (req, res) => {
  try {
    const snapshot = db.getDashboardSnapshot();
    res.json({ ok: true, date: snapshot.date });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/vitals', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const database = db.getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // SpO2: daily average, last N days
    const spo2 = database.prepare(`
      SELECT date, AVG(value) as value FROM spo2
      WHERE date >= ? GROUP BY date ORDER BY date ASC
    `).all(cutoffStr);

    res.json({
      hrv: db.getRecentHRV(days),
      sleep: db.getRecentSleep(14),
      activity: db.getRecentActivity(days),
      vitals: db.getRecentVitals(days),
      workouts: db.getWorkouts(days),
      spo2,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/vitals/sleep-stages/:date', (req, res) => {
  try {
    res.json(db.getSleepStages(req.params.date));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/gut', (req, res) => {
  try {
    res.json(db.getGutLogs(90));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/gut', (req, res) => {
  try {
    const {
      pain_locations, location,
      pain_severity,
      bristol_type, stool_type,
      bloat_level, bloating,
      gas_level, gas,
      reflux_level, reflux,
      notes, date
    } = req.body;

    const database = db.getDb();
    const severity = pain_severity || 0;
    const bloat = bloat_level ?? bloating ?? 0;
    const gasVal = gas_level ?? gas ?? 0;
    const refluxVal = reflux_level ?? reflux ?? 0;
    const bristol = bristol_type ?? stool_type ?? null;
    const locations = pain_locations || (location ? [location] : []);
    const logDate = date || new Date().toISOString().slice(0, 10);
    const gut_score = Math.max(0, Math.round(100 - (severity * 7 + bloat * 3 + gasVal * 2)));

    database.prepare(`INSERT INTO gut_logs (date, pain_locations, pain_severity, bristol_type, bloat_level, gas_level, reflux_level, notes, gut_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(logDate, JSON.stringify(locations), severity, bristol, bloat, gasVal, refluxVal, notes || '', gut_score);
    res.json({ ok: true, gut_score });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Food lookup via Edamam
app.get('/api/food/search', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'query required' });

    const appId = process.env.EDAMAM_APP_ID;
    const appKey = process.env.EDAMAM_APP_KEY;

    if (!appId || !appKey) {
      return res.json({ foods: [mockFoodEntry(query)] });
    }

    const url = `https://api.edamam.com/api/nutrition-data?app_id=${appId}&app_key=${appKey}&nutrition-type=logging&ingr=${encodeURIComponent(query)}`;
    const fetch = require('node-fetch');
    const response = await fetch(url);
    const data = await response.json();

    const nutrients = data.totalNutrients || {};
    res.json({
      foods: [{
        food_name: query,
        calories: Math.round(data.calories || 0),
        protein: Math.round((nutrients.PROCNT?.quantity || 0) * 10) / 10,
        carbs: Math.round((nutrients.CHOCDF?.quantity || 0) * 10) / 10,
        fat: Math.round((nutrients.FAT?.quantity || 0) * 10) / 10,
        fibre: Math.round((nutrients.FIBTG?.quantity || 0) * 10) / 10,
        fodmap_risk: 'unknown',
      }]
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function mockFoodEntry(query) {
  return {
    food_name: query,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fibre: 0,
    fodmap_risk: 'unknown',
    _mock: true,
  };
}

app.post('/api/diet', (req, res) => {
  try {
    const { food_name, description, calories, protein, carbs, fat, fibre, fodmap_risk, meal_type, raw_input, date } = req.body;
    const name = food_name || description || raw_input || 'Unknown food';
    const logDate = date || new Date().toISOString().slice(0, 10);
    db.getDb().prepare(`INSERT INTO diet_logs (date, food_name, calories, protein, carbs, fat, fibre, fodmap_risk, meal_type, raw_input)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(logDate, name, calories || 0, protein || 0, carbs || 0, fat || 0, fibre || 0, fodmap_risk || 'unknown', meal_type || 'snack', raw_input || name);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/diet', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    res.json({
      logs: db.getDietLogs(days),
      today: db.getTodayDietSummary(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/supplements', (req, res) => {
  try {
    const { name, dose, form, timing, notes } = req.body;
    db.getDb().prepare('INSERT INTO supplements (name, dose, form, timing, notes) VALUES (?, ?, ?, ?, ?)')
      .run(name, dose || '', form || '', timing || '', notes || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/supplements', (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    res.json(db.getDb().prepare('SELECT * FROM supplements WHERE date = ? ORDER BY timestamp DESC').all(today));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cognitive tests
app.post('/api/cognitive', (req, res) => {
  try {
    const { test_type, score, accuracy, attempts, sleep_hours, morning_hrv, caffeine_mg, stress_level, notes } = req.body;
    db.getDb().prepare(`INSERT INTO cognitive_tests (test_type, score, accuracy, attempts, sleep_hours, morning_hrv, caffeine_mg, stress_level, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(test_type, score, accuracy || null, attempts || null, sleep_hours || null, morning_hrv || null, caffeine_mg || null, stress_level || null, notes || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cognitive', (req, res) => {
  try {
    res.json(db.getCognitiveTests(90));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Lab results
app.post('/api/labs', (req, res) => {
  try {
    const { date, biomarker, name, value, unit, ref_min, ref_max, optimal_min, optimal_max, category, source, lab_name, notes } = req.body;
    const biomarkerName = biomarker || name || 'Unknown';
    const sourceLabel = source || lab_name || 'manual';
    db.getDb().prepare(`INSERT INTO biomarkers (date, category, name, value, unit, ref_min, ref_max, optimal_min, optimal_max, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(date || new Date().toISOString().slice(0, 10), category || 'general', biomarkerName, value, unit || '', ref_min ?? null, ref_max ?? null, optimal_min ?? null, optimal_max ?? null, sourceLabel, notes || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/labs', (req, res) => {
  try {
    res.json({
      latest: db.getBiomarkers(),
      targets: getBiomarkerTargets(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/labs/:name/history', (req, res) => {
  try {
    res.json(db.getBiomarkerHistory(decodeURIComponent(req.params.name)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Longevity OS
app.get('/api/longevity', (req, res) => {
  try {
    const database = db.getDb();

    // Key biomarkers — most recent value per name across all dates
    const biomarkers = database.prepare(`
      SELECT b.name, b.value, b.unit, b.ref_min, b.ref_max, b.optimal_min, b.optimal_max, b.date
      FROM biomarkers b
      INNER JOIN (
        SELECT name, MAX(date) as max_date FROM biomarkers GROUP BY name
      ) latest ON b.name = latest.name AND b.date = latest.max_date
      ORDER BY b.name
    `).all();

    // Build biomarker map
    const bm = {};
    biomarkers.forEach(b => { bm[b.name] = b; });

    // Latest vitals for biological age calc
    const latestHRV = database.prepare(`SELECT AVG(rmssd) as v FROM hrv WHERE substr(timestamp,1,10) >= date('now','-30 days')`).get()?.v;
    const latestRHR = database.prepare(`SELECT AVG(resting_hr) as v FROM vitals WHERE date >= date('now','-30 days') AND resting_hr > 0`).get()?.v;
    const latestVO2 = database.prepare(`SELECT value FROM biomarkers WHERE name = 'VO2max' ORDER BY date DESC LIMIT 1`).get()?.value;
    const latestBF = database.prepare(`SELECT body_fat_pct FROM body_comp ORDER BY date DESC LIMIT 1`).get()?.body_fat_pct;

    // Biological age estimate
    let bioAge = null;
    let bioAgeFactors = [];
    const chronoAge = 25;
    const ageDeltas = [];
    if (latestHRV && latestHRV > 0) {
      // Higher HRV = younger biological age. 70ms is ~20yo, 40ms is ~40yo
      const delta = (latestHRV - 55) / 3; // every 3ms above 55 = 1 year younger
      ageDeltas.push(delta);
      bioAgeFactors.push({ label: 'HRV', value: Math.round(latestHRV), unit: 'ms', delta });
    }
    if (latestRHR && latestRHR > 0) {
      // Lower RHR = younger. 50bpm = -3y, 60bpm = 0, 70bpm = +5y
      const delta = (60 - latestRHR) / 2;
      ageDeltas.push(delta);
      bioAgeFactors.push({ label: 'Resting HR', value: Math.round(latestRHR), unit: 'bpm', delta });
    }
    if (bm['HbA1c']) {
      const v = bm['HbA1c'].value;
      const delta = (33 - v) / 2; // 27 = -3y, 33 = 0, 40 = +3.5y
      ageDeltas.push(delta);
      bioAgeFactors.push({ label: 'HbA1c', value: v, unit: 'mmol/mol', delta });
    }
    if (bm['hs-CRP'] || bm['CRP']) {
      const crp = bm['hs-CRP'] || bm['CRP'];
      const delta = crp.value < 0.5 ? 3 : crp.value < 1 ? 1 : crp.value < 3 ? -1 : -4;
      ageDeltas.push(delta);
      bioAgeFactors.push({ label: 'hs-CRP', value: crp.value, unit: 'mg/L', delta });
    }
    if (latestBF) {
      // Lean body fat for age. <15% = -2y, 15-20% = 0, >25% = +3y
      const delta = latestBF < 15 ? 2 : latestBF < 20 ? 0 : -Math.round((latestBF - 20) / 2);
      ageDeltas.push(delta);
      bioAgeFactors.push({ label: 'Body Fat', value: latestBF, unit: '%', delta });
    }
    if (ageDeltas.length > 0) {
      const avgDelta = ageDeltas.reduce((a, b) => a + b, 0) / ageDeltas.length;
      bioAge = Math.round(chronoAge - avgDelta * 1.5);
    }

    // Longevity score out of 100
    let longevityScore = 50;
    const scoreItems = [];

    // hs-CRP (inflammation — major longevity factor, weight 20)
    const crpVal = (bm['hs-CRP'] || bm['CRP'])?.value;
    if (crpVal !== undefined) {
      const crpScore = crpVal < 0.5 ? 20 : crpVal < 1 ? 15 : crpVal < 3 ? 8 : 0;
      scoreItems.push({ label: 'Inflammation (hs-CRP)', score: crpScore, max: 20 });
    }
    // HbA1c (metabolic, weight 15)
    const hba1cVal = bm['HbA1c']?.value;
    if (hba1cVal !== undefined) {
      const hba1cScore = hba1cVal < 30 ? 15 : hba1cVal < 35 ? 12 : hba1cVal < 40 ? 8 : 3;
      scoreItems.push({ label: 'Metabolic (HbA1c)', score: hba1cScore, max: 15 });
    }
    // Omega-3 Index (cardiovascular, weight 15)
    const omega3Val = bm['Omega-3 Index']?.value;
    if (omega3Val !== undefined) {
      const o3Score = omega3Val >= 8 ? 15 : omega3Val >= 6 ? 10 : omega3Val >= 4 ? 5 : 2;
      scoreItems.push({ label: 'Omega-3 Index', score: o3Score, max: 15 });
    }
    // Vitamin D (immune + longevity, weight 10)
    const vitdVal = bm['Vitamin D']?.value || bm['25-OH Vitamin D']?.value;
    if (vitdVal !== undefined) {
      const vdScore = vitdVal >= 75 ? 10 : vitdVal >= 50 ? 7 : vitdVal >= 30 ? 4 : 1;
      scoreItems.push({ label: 'Vitamin D', score: vdScore, max: 10 });
    }
    // HRV (autonomic health, weight 20)
    if (latestHRV) {
      const hrvScore = latestHRV >= 80 ? 20 : latestHRV >= 60 ? 15 : latestHRV >= 40 ? 10 : 5;
      scoreItems.push({ label: 'HRV', score: hrvScore, max: 20 });
    }
    // Gut health (weight 10) — use correct stored name
    const hpylori = database.prepare(`SELECT value FROM biomarkers WHERE name = 'H. pylori Antigen' ORDER BY date DESC LIMIT 1`).get()?.value;
    const hpyloriScore = hpylori === 0 ? 10 : hpylori === 1 ? 3 : 7;
    scoreItems.push({ label: 'Gut Health', score: hpyloriScore, max: 10 });

    // Testosterone (weight 10)
    const testVal = bm['Total Testosterone']?.value || bm['Testosterone']?.value;
    if (testVal !== undefined) {
      const tScore = testVal >= 18 ? 10 : testVal >= 14 ? 7 : testVal >= 9 ? 4 : 1;
      scoreItems.push({ label: 'Testosterone', score: tScore, max: 10 });
    }

    if (scoreItems.length > 0) {
      const total = scoreItems.reduce((a, i) => a + i.score, 0);
      const maxTotal = scoreItems.reduce((a, i) => a + i.max, 0);
      longevityScore = Math.round((total / maxTotal) * 100);
    }

    // All active longevity protocols
    const protocols = database.prepare(`SELECT * FROM protocols WHERE active = 1`).all();

    // Timeline events
    const timeline = [
      { date: '2026-04-22', label: 'Blood & Gut Test Results Logged', status: 'done', icon: '🔬' },
      { date: 'Now', label: 'H. pylori triple therapy — complete full course', status: 'active', icon: '💊' },
      { date: 'Now', label: 'Upgrade Omega-3 to 3g EPA+DHA/day', status: 'active', icon: '🐟' },
      { date: '~June 2026', label: 'Retest: H. pylori + calprotectin (8 weeks post-treatment)', status: 'upcoming', icon: '🧫' },
      { date: 'Oct 2026', label: 'Full blood panel retest — stop creatine 7 days prior', status: 'upcoming', icon: '🩸' },
      { date: 'Ongoing', label: 'Zone 2 cardio 3-4 hrs/week', status: 'ongoing', icon: '🚴' },
      { date: 'Ongoing', label: 'Strength training 3x/week', status: 'ongoing', icon: '🏋️' },
    ];

    res.json({
      bioAge,
      bioAgeFactors,
      longevityScore,
      scoreItems,
      biomarkers,
      protocols,
      timeline,
      keyMetrics: {
        crp: crpVal,
        hba1c: hba1cVal,
        omega3: omega3Val,
        vitd: vitdVal,
        hrv: latestHRV ? Math.round(latestHRV) : null,
        rhr: latestRHR ? Math.round(latestRHR) : null,
        testosterone: testVal,
        hpylori: hpylori,
      }
    });
  } catch (e) {
    console.error('Longevity API error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Protocol
app.get('/api/protocols', (req, res) => {
  try {
    const database = db.getDb();
    const protocols = database.prepare('SELECT * FROM protocols WHERE active = 1').all();
    const today = new Date().toISOString().slice(0, 10);
    const logs = db.getTodayProtocolLog();
    const adherence = db.getProtocolAdherence(30);
    res.json({ protocols, today_logs: logs, adherence });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/protocols/log', (req, res) => {
  try {
    const { protocol_id, item, completed } = req.body;
    const database = db.getDb();
    const today = new Date().toISOString().slice(0, 10);
    const existing = database.prepare('SELECT id FROM protocol_logs WHERE date = ? AND item = ?').get(today, item);
    if (existing) {
      database.prepare('UPDATE protocol_logs SET completed = ? WHERE id = ?').run(completed ? 1 : 0, existing.id);
    } else {
      database.prepare('INSERT INTO protocol_logs (protocol_id, date, item, completed) VALUES (?, ?, ?, ?)').run(protocol_id || 1, today, item, completed ? 1 : 0);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Correlations
app.get('/api/correlations', (req, res) => {
  try {
    const database = db.getDb();
    const lagAnalysis = runLagAnalysis(database);
    const weekStats = getWeeklyStats(database);
    res.json({ lag_analysis: lagAnalysis, week_stats: weekStats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/correlations/scatter', (req, res) => {
  try {
    const { x, y, days } = req.query;
    const data = getScatterData(db.getDb(), x || 'sleep', y || 'hrv', parseInt(days) || 60);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Experiments
app.get('/api/experiments', (req, res) => {
  try {
    const exps = db.getDb().prepare('SELECT * FROM experiments ORDER BY created_at DESC').all();
    res.json(exps);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/experiments', (req, res) => {
  try {
    const { name, hypothesis, start_date, end_date, outcome_metric, notes } = req.body;
    db.getDb().prepare('INSERT INTO experiments (name, hypothesis, start_date, end_date, outcome_metric, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(name, hypothesis || '', start_date || new Date().toISOString().slice(0, 10), end_date || null, outcome_metric || '', notes || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/experiments/:id', (req, res) => {
  try {
    const { end_date, status, result_summary } = req.body;
    db.getDb().prepare('UPDATE experiments SET end_date = ?, status = ?, result_summary = ? WHERE id = ?')
      .run(end_date || null, status || 'completed', result_summary || '', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// JARVIS Briefing
app.get('/api/jarvis/briefing', (req, res) => {
  try {
    const briefing = db.getLatestBriefing('daily');
    const anomalies = jarvis.checkAnomalies(db.getDb());
    res.json({ briefing, anomalies });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/jarvis/briefing/generate', async (req, res) => {
  try {
    const snapshot = db.getDashboardSnapshot();
    const result = await jarvis.generateDailyBriefing(snapshot);
    if (result?.content) {
      const today = new Date().toISOString().slice(0, 10);
      db.getDb().prepare('INSERT INTO jarvis_briefings (date, type, content, tokens_used) VALUES (?, ?, ?, ?)')
        .run(today, 'daily', result.content, result.tokens || 0);
    }
    res.json({ briefing: result?.content || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Performance / workouts
app.get('/api/performance', (req, res) => {
  try {
    res.json({
      workouts: db.getWorkouts(90),
      zone2_weekly: db.getZone2WeeklyHours(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/workouts', (req, res) => {
  try {
    const { date, type, duration_minutes, calories, distance_km, avg_hr, max_hr, notes } = req.body;
    db.getDb().prepare(`INSERT INTO workouts (date, type, duration_minutes, calories, distance_km, avg_hr, max_hr, notes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
    ).run(date || new Date().toISOString().slice(0, 10), type, duration_minutes || 0, calories || 0, distance_km || 0, avg_hr || null, max_hr || null, notes || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/body-comp', (req, res) => {
  try {
    const { date, weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg,
            waist_cm, chest_cm, arm_cm, neck_cm, hip_cm, source, notes } = req.body;

    const logDate = date || new Date().toISOString().slice(0, 10);

    // Auto-calculate lean mass if weight + BF% provided
    const bf = body_fat_pct || null;
    const wt = weight_kg || null;
    const lean = lean_mass_kg || (wt && bf ? Math.round((wt * (1 - bf / 100)) * 10) / 10 : null);

    db.getDb().prepare(`INSERT INTO body_comp
      (date, weight_kg, body_fat_pct, lean_mass_kg, muscle_mass_kg, waist_cm, chest_cm, arm_cm, neck_cm, hip_cm, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(logDate, wt, bf, lean, muscle_mass_kg || null,
          waist_cm || null, chest_cm || null, arm_cm || null, neck_cm || null, hip_cm || null,
          source || 'manual', notes || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/body-comp', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 180;
    const database = db.getDb();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const history = database.prepare(
      'SELECT * FROM body_comp WHERE date >= ? ORDER BY date ASC'
    ).all(cutoffStr);

    const latest = database.prepare(
      'SELECT * FROM body_comp ORDER BY date DESC, id DESC LIMIT 1'
    ).get();

    // Weekly averages for smooth chart
    const weeklyAvg = database.prepare(`
      SELECT strftime('%Y-%W', date) as week,
        MIN(date) as date,
        AVG(weight_kg) as weight_kg,
        AVG(body_fat_pct) as body_fat_pct,
        AVG(lean_mass_kg) as lean_mass_kg
      FROM body_comp WHERE date >= ?
      GROUP BY strftime('%Y-%W', date)
      ORDER BY week ASC
    `).all(cutoffStr);

    // 6-month best/worst
    const stats = history.length > 0 ? {
      weight_min: Math.min(...history.filter(r => r.weight_kg).map(r => r.weight_kg)),
      weight_max: Math.max(...history.filter(r => r.weight_kg).map(r => r.weight_kg)),
      bf_min: Math.min(...history.filter(r => r.body_fat_pct).map(r => r.body_fat_pct)),
      bf_max: Math.max(...history.filter(r => r.body_fat_pct).map(r => r.body_fat_pct)),
      entries: history.length,
    } : null;

    res.json({ latest, history, weekly: weeklyAvg, stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Biomarker targets for a 25yr male
function getBiomarkerTargets() {
  return [
    { name: 'VO2max', unit: 'mL/kg/min', target: 55, elite: 60, low: 38, category: 'physical' },
    { name: 'Resting HR', unit: 'bpm', target: 55, elite: 50, high: 70, lower_is_better: true, category: 'recovery' },
    { name: 'HRV (RMSSD)', unit: 'ms', target: 60, elite: 80, low: 30, category: 'recovery' },
    { name: 'Fasting Glucose', unit: 'mg/dL', target: 85, elite: 80, high: 99, lower_is_better: true, category: 'metabolic' },
    { name: 'Fasting Insulin', unit: 'µIU/mL', target: 6, elite: 4, high: 15, lower_is_better: true, category: 'metabolic' },
    { name: 'ApoB', unit: 'mg/dL', target: 70, elite: 60, high: 100, lower_is_better: true, category: 'longevity' },
    { name: 'hsCRP', unit: 'mg/L', target: 1.0, elite: 0.5, high: 3.0, lower_is_better: true, category: 'longevity' },
    { name: 'Testosterone (Free)', unit: 'ng/dL', target: 700, elite: 900, low: 400, category: 'hormonal' },
    { name: 'Vitamin D', unit: 'ng/mL', target: 55, elite: 65, low: 30, category: 'longevity' },
    { name: 'DunedinPACE', unit: 'yrs/yr', target: 0.85, elite: 0.75, high: 1.0, lower_is_better: true, category: 'longevity' },
    { name: 'Omega-3 Index', unit: '%', target: 8, elite: 10, low: 4, category: 'longevity' },
    { name: 'Ferritin', unit: 'ng/mL', target: 100, low: 30, high: 300, category: 'metabolic' },
    { name: 'HOMA-IR', unit: '', target: 1.0, elite: 0.5, high: 2.5, lower_is_better: true, category: 'metabolic' },
    { name: 'Calprotectin', unit: 'µg/g', target: 50, elite: 30, high: 200, lower_is_better: true, category: 'gut' },
  ];
}

// ─── CRON Jobs ───────────────────────────────────────────────────────────────

// Daily briefing at 7am
cron.schedule('0 7 * * *', async () => {
  console.log('[JARVIS] Generating daily briefing...');
  try {
    const database = db.getDb();
    const snapshot = db.getDashboardSnapshot();
    // Enrich with readiness and training load for smarter briefing
    snapshot.readiness = calcReadinessScore(database);
    snapshot.training_load = calcTrainingLoad(database);
    const result = await jarvis.generateDailyBriefing(snapshot);
    if (result?.content) {
      const today = new Date().toISOString().slice(0, 10);
      db.getDb().prepare('INSERT INTO jarvis_briefings (date, type, content, tokens_used) VALUES (?, ?, ?, ?)')
        .run(today, 'daily', result.content, result.tokens || 0);
      console.log('[JARVIS] Daily briefing saved.');
    }
  } catch (e) {
    console.error('[JARVIS] Daily briefing failed:', e.message);
  }
});

// Old weekly cron (replaced by Sunday 8pm Telegram report below)
cron.schedule('0 8 * * 0', async () => {
  console.log('[JARVIS] Generating weekly report...');
  try {
    const database = db.getDb();
    const weekStats = getWeeklyStats(database);
    const result = await jarvis.generateWeeklyReport(weekStats);
    if (result?.content) {
      db.getDb().prepare('INSERT INTO jarvis_briefings (date, type, content, tokens_used) VALUES (?, ?, ?, ?)')
        .run(new Date().toISOString().slice(0, 10), 'weekly', result.content, result.tokens || 0);
      console.log('[JARVIS] Weekly report saved.');
    }
  } catch (e) {
    console.error('[JARVIS] Weekly report failed:', e.message);
  }
});

// ─── JARVIS Chat — Tool-Calling Agent Loop (PitchPredict pattern) ────────────
//
// Architecture (stolen from PitchPredict's agent.py):
//  User message → GPT-4o with tools → execute tools → loop until final answer
//  Tools give JARVIS actual DB access: it CAN query data, not just log it.

// ── Tool executor functions ───────────────────────────────────────────────────

function toolGetHealthSnapshot() {
  try {
    const database = db.getDb();
    const sevenDaysAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const hrv = database.prepare(`SELECT rmssd, timestamp FROM hrv ORDER BY timestamp DESC LIMIT 1`).get();
    const rhr = database.prepare(`SELECT resting_hr FROM vitals WHERE resting_hr IS NOT NULL ORDER BY date DESC LIMIT 1`).get();
    const steps = database.prepare(`SELECT steps, active_calories, exercise_minutes FROM activity ORDER BY date DESC LIMIT 1`).get();
    const sleep = database.prepare(`SELECT date, total_minutes, deep_minutes, rem_minutes, efficiency FROM sleep ORDER BY date DESC LIMIT 1`).get();
    const spo2 = database.prepare(`SELECT value FROM spo2 ORDER BY timestamp DESC LIMIT 1`).get();
    const weight = database.prepare(`SELECT weight_kg, body_fat_pct FROM body_comp ORDER BY date DESC LIMIT 1`).get();
    const gut7 = database.prepare(`SELECT AVG(pain_severity) as avg_pain, AVG(bloat_level) as avg_bloat FROM gut_logs WHERE date >= ?`).get(sevenDaysAgo);
    const workouts7 = database.prepare(`SELECT COUNT(*) as count FROM workouts WHERE date >= ?`).get(sevenDaysAgo);

    // Always include today's supplements so the agent knows what's on file
    const todaySupps = database.prepare(`SELECT name, dose, timing FROM supplements WHERE date = ? ORDER BY id ASC`).all(today);
    // If none today, get most recent day's supplements as the "usual" protocol
    const recentSupps = todaySupps.length > 0 ? todaySupps
      : database.prepare(`SELECT name, dose, timing, date FROM supplements ORDER BY date DESC LIMIT 20`).all();

    // Latest lab results — most recent value per biomarker
    const latestBiomarkers = database.prepare(`
      SELECT b.name, b.value, b.unit, b.date, b.category
      FROM biomarkers b
      INNER JOIN (SELECT name, MAX(date) as max_date FROM biomarkers GROUP BY name) latest
        ON b.name = latest.name AND b.date = latest.max_date
      ORDER BY b.category, b.name
    `).all();

    const sleepHours = sleep ? `${Math.floor(sleep.total_minutes / 60)}h${sleep.total_minutes % 60}m` : null;

    return {
      hrv_rmssd_ms: hrv?.rmssd || null,
      hrv_timestamp: hrv?.timestamp || null,
      resting_hr_bpm: rhr?.resting_hr || null,
      steps_today: steps?.steps || null,
      active_calories_today: steps?.active_calories || null,
      exercise_minutes_today: steps?.exercise_minutes || null,
      sleep: sleep ? { date: sleep.date, total: sleepHours, total_minutes: sleep.total_minutes, deep_min: sleep.deep_minutes, rem_min: sleep.rem_minutes, efficiency: sleep.efficiency } : null,
      spo2_pct: spo2?.value || null,
      weight_kg: weight?.weight_kg || null,
      body_fat_pct: weight?.body_fat_pct || null,
      gut_7day_avg: { pain: gut7?.avg_pain ? parseFloat(gut7.avg_pain).toFixed(1) : null, bloat: gut7?.avg_bloat ? parseFloat(gut7.avg_bloat).toFixed(1) : null },
      workouts_this_week: workouts7?.count || 0,
      supplements_on_file: recentSupps.length > 0
        ? recentSupps.map(s => `${s.name}${s.dose ? ' ' + s.dose : ''}${s.timing ? ' [' + s.timing + ']' : ''}`)
        : 'none logged yet',
      lab_results: latestBiomarkers.length > 0
        ? latestBiomarkers.map(b => `${b.name}: ${b.value}${b.unit ? ' ' + b.unit : ''} (tested ${b.date})`)
        : 'none logged yet',
    };
  } catch (e) {
    return { error: e.message };
  }
}

function toolGetRecentLogs({ category, days = 7 }) {
  try {
    const database = db.getDb();
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

    const queries = {
      diet: `SELECT date, meal_type, food_name, calories, protein, carbs, fat FROM diet_logs WHERE date >= ? ORDER BY date DESC LIMIT 20`,
      gut: `SELECT date, pain_severity, bloat_level, gas_level, reflux_level, bristol_type, notes FROM gut_logs WHERE date >= ? ORDER BY date DESC LIMIT 20`,
      workout: `SELECT date, type, duration_minutes, avg_hr, notes FROM workouts WHERE date >= ? ORDER BY date DESC LIMIT 15`,
      body_comp: `SELECT date, weight_kg, body_fat_pct, lean_mass_kg FROM body_comp WHERE date >= ? ORDER BY date DESC LIMIT 10`,
      sleep: `SELECT date, total_minutes, deep_minutes, rem_minutes, efficiency FROM sleep WHERE date >= ? ORDER BY date DESC LIMIT 10`,
      hrv: `SELECT SUBSTR(timestamp, 1, 10) as date, rmssd FROM hrv WHERE SUBSTR(timestamp, 1, 10) >= ? ORDER BY timestamp DESC LIMIT 10`,
      supplement: `SELECT date, name, dose, timing FROM supplements WHERE date >= ? ORDER BY date DESC LIMIT 20`,
    };

    const sql = queries[category];
    if (!sql) return { error: `Unknown category '${category}'. Valid: diet, gut, workout, body_comp, sleep, hrv, supplement` };

    const rows = database.prepare(sql).all(since);
    return { category, days, count: rows.length, data: rows };
  } catch (e) {
    return { error: e.message };
  }
}

function toolLogDiet({ food_name, meal_type = 'meal', calories = null, protein_g = null, carbs_g = null, fat_g = null, fiber_g = null, notes = '', date = null }) {
  try {
    const database = db.getDb();
    const d = date || new Date().toISOString().slice(0, 10);
    database.prepare(`INSERT INTO diet_logs (date, meal_type, food_name, calories, protein, carbs, fat, fibre, raw_input) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(d, meal_type, food_name || 'Food', calories, protein_g, carbs_g, fat_g, fiber_g, `[JARVIS] ${food_name || ''}`);
    return { success: true, logged: `diet: ${food_name}`, date: d };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function toolDeleteDietLog({ food_name, date = null }) {
  try {
    const database = db.getDb();
    const d = date || new Date().toISOString().slice(0, 10);
    const result = database.prepare(`DELETE FROM diet_logs WHERE date = ? AND food_name LIKE ? ORDER BY id DESC LIMIT 1`)
      .run(d, `%${food_name}%`);
    return { success: true, deleted: result.changes, food_name, date: d };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function toolLogGut({ pain_severity = 0, bloat_level = 0, gas_level = 0, reflux_level = 0, bristol_type = null, pain_locations = null, notes = '', date = null }) {
  try {
    const database = db.getDb();
    const d = date || new Date().toISOString().slice(0, 10);
    database.prepare(`INSERT INTO gut_logs (date, pain_severity, bloat_level, gas_level, reflux_level, bristol_type, pain_locations, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(d, pain_severity, bloat_level, gas_level, reflux_level, bristol_type, pain_locations, notes);
    return { success: true, logged: 'gut log', date: d };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function toolLogWorkout({ type = 'Other', duration_min = null, avg_hr = null, notes = '', date = null }) {
  try {
    const database = db.getDb();
    const d = date || new Date().toISOString().slice(0, 10);
    database.prepare(`INSERT INTO workouts (date, type, duration_minutes, avg_hr, notes, source) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(d, type, duration_min, avg_hr, notes, 'jarvis-chat');
    return { success: true, logged: `workout: ${type}`, date: d };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function toolLogBodyComp({ weight_kg = null, body_fat_pct = null, waist_cm = null, notes = '', date = null }) {
  try {
    const database = db.getDb();
    const d = date || new Date().toISOString().slice(0, 10);
    const lean = weight_kg && body_fat_pct ? Math.round((weight_kg * (1 - body_fat_pct / 100)) * 10) / 10 : null;
    // Upsert — update existing entry for today if it exists
    const existing = database.prepare('SELECT id FROM body_comp WHERE date = ? ORDER BY id DESC LIMIT 1').get(d);
    if (existing) {
      database.prepare(`UPDATE body_comp SET weight_kg = COALESCE(?, weight_kg), body_fat_pct = COALESCE(?, body_fat_pct),
        lean_mass_kg = COALESCE(?, lean_mass_kg), waist_cm = COALESCE(?, waist_cm), notes = ?, source = 'jarvis-chat' WHERE id = ?`)
        .run(weight_kg, body_fat_pct, lean, waist_cm, notes, existing.id);
    } else {
      database.prepare(`INSERT INTO body_comp (date, weight_kg, body_fat_pct, lean_mass_kg, waist_cm, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(d, weight_kg, body_fat_pct, lean, waist_cm, 'jarvis-chat', notes);
    }
    return { success: true, logged: 'body comp', date: d, lean_mass_kg: lean };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function toolLogSupplement({ name, dose = '', timing = 'morning', notes = '', date = null }) {
  try {
    const database = db.getDb();
    const d = date || new Date().toISOString().slice(0, 10);
    database.prepare(`INSERT INTO supplements (date, name, dose, form, timing, notes) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(d, name, dose, '', timing, notes);
    return { success: true, logged: `supplement: ${name}`, date: d };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function toolLogMood({ valence = 'neutral', energy = 'medium', notes = '', focus_score = null, energy_score = null, mood_score = null, date = null }) {
  try {
    const database = db.getDb();
    const d = date || new Date().toISOString().slice(0, 10);
    // Map string valence to numeric (Apple Health scale)
    const valenceMap = { pleasant: 5, slightly_pleasant: 4, neutral: 3, slightly_unpleasant: 2, unpleasant: 1 };
    const valenceNum = valenceMap[valence] || 3;
    database.prepare(`INSERT INTO state_of_mind (date, valence, labels, associations, source) VALUES (?, ?, ?, ?, ?)`)
      .run(d, valenceNum, energy, notes || '', 'jarvis-chat');
    if (focus_score || energy_score || mood_score) {
      database.prepare(`INSERT INTO cognitive_tests (date, test_type, notes, stress_level) VALUES (?, ?, ?, ?)`)
        .run(d, 'journal', notes || '', null);
    }
    return { success: true, logged: 'mood/cognitive log', date: d };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ── Tool definitions (OpenAI format) ─────────────────────────────────────────

const JARVIS_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_health_snapshot',
      description: 'Get Jack\'s current biometric snapshot: HRV, resting HR, steps, sleep, SpO2, weight, 7-day gut averages, workout count this week. Use this when Jack asks how he\'s doing, wants a status check, or you need context before answering a health question.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_logs',
      description: 'Query recent logged data from a specific category. Use this to answer questions like "how has my gut been?", "what did I eat this week?", "show me my recent workouts", etc.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['diet', 'gut', 'workout', 'body_comp', 'sleep', 'hrv', 'supplement'],
            description: 'Which data category to query'
          },
          days: {
            type: 'integer',
            description: 'How many days back to look (default 7)',
            default: 7
          }
        },
        required: ['category']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_diet',
      description: 'Log a meal or food item Jack ate. Estimate calories/macros if not given.',
      parameters: {
        type: 'object',
        properties: {
          food_name: { type: 'string', description: 'Name of the food or meal' },
          meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'meal'], description: 'Meal type' },
          calories: { type: 'number', description: 'Estimated calories (null if unknown)' },
          protein_g: { type: 'number', description: 'Protein in grams' },
          carbs_g: { type: 'number', description: 'Carbs in grams' },
          fat_g: { type: 'number', description: 'Fat in grams' },
          fiber_g: { type: 'number', description: 'Fibre in grams' },
          notes: { type: 'string', description: 'Any extra notes' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format (null = today)' }
        },
        required: ['food_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_diet_log',
      description: 'Delete a food log entry. Use when Jack corrects a food entry — delete the wrong one first, then log the correct one.',
      parameters: {
        type: 'object',
        properties: {
          food_name: { type: 'string', description: 'Name (or partial name) of the food entry to delete' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format (null = today)' }
        },
        required: ['food_name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_gut',
      description: 'Log gut health symptoms: pain, bloating, gas, reflux, bowel movement type. Use when Jack mentions stomach issues, gut symptoms, or digestive events.',
      parameters: {
        type: 'object',
        properties: {
          pain_severity: { type: 'number', description: 'Pain level 0-10' },
          bloat_level: { type: 'number', description: 'Bloating level 0-10' },
          gas_level: { type: 'number', description: 'Gas level 0-10' },
          reflux_level: { type: 'number', description: 'Reflux/heartburn level 0-10' },
          bristol_type: { type: 'number', description: 'Bristol stool scale 1-7 (null if not mentioned)' },
          pain_locations: { type: 'string', description: 'Where is the pain? e.g. "lower right"' },
          notes: { type: 'string', description: 'Description of symptoms' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD (null = today)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_workout',
      description: 'Log a workout session. Use when Jack mentions training, gym, running, cycling, sport etc.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['Zone 2 Cardio', 'Strength', 'HIIT', 'Sport', 'Walk', 'Run', 'Cycling', 'Other'], description: 'Workout type' },
          duration_min: { type: 'number', description: 'Duration in minutes' },
          avg_hr: { type: 'number', description: 'Average heart rate bpm (null if unknown)' },
          notes: { type: 'string', description: 'Workout notes, exercises done, how it felt' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD (null = today)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_body_comp',
      description: 'Log body composition data: weight, body fat %, waist measurement.',
      parameters: {
        type: 'object',
        properties: {
          weight_kg: { type: 'number', description: 'Weight in kg' },
          body_fat_pct: { type: 'number', description: 'Body fat percentage' },
          waist_cm: { type: 'number', description: 'Waist circumference in cm' },
          notes: { type: 'string', description: 'Notes' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD (null = today)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_supplement',
      description: 'Log a supplement Jack took.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Supplement name e.g. "Creatine", "Omega-3"' },
          dose: { type: 'string', description: 'Dose e.g. "5g", "2 capsules"' },
          timing: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'pre-workout', 'post-workout', 'with-meal', 'before-bed'], description: 'When taken' },
          notes: { type: 'string', description: 'Notes' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD (null = today)' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'log_mood',
      description: 'Log mood, mental state, energy levels, cognitive performance. Use when Jack mentions how he feels, energy, focus, stress, mood.',
      parameters: {
        type: 'object',
        properties: {
          valence: { type: 'string', enum: ['pleasant', 'slightly_pleasant', 'neutral', 'slightly_unpleasant', 'unpleasant'], description: 'Overall emotional valence' },
          energy: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Energy level' },
          notes: { type: 'string', description: 'Description of mental/cognitive state' },
          focus_score: { type: 'number', description: 'Focus score 1-10 (null if not mentioned)' },
          energy_score: { type: 'number', description: 'Energy score 1-10 (null if not mentioned)' },
          mood_score: { type: 'number', description: 'Mood score 1-10 (null if not mentioned)' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD (null = today)' }
        }
      }
    }
  }
];

const JARVIS_TOOL_MAP = {
  get_health_snapshot: toolGetHealthSnapshot,
  get_recent_logs: toolGetRecentLogs,
  log_diet: toolLogDiet,
  delete_diet_log: toolDeleteDietLog,
  log_gut: toolLogGut,
  log_workout: toolLogWorkout,
  log_body_comp: toolLogBodyComp,
  log_supplement: toolLogSupplement,
  log_mood: toolLogMood
};

// ── Claude tool definitions (Anthropic format) ───────────────────────────────
// Convert from OpenAI {type:'function', function:{name,description,parameters}}
// to Anthropic {name, description, input_schema}
const CLAUDE_TOOLS = JARVIS_TOOLS.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters
}));

// ── Agent loop (Claude Sonnet) ────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'No message provided' });

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const today = new Date().toISOString().slice(0, 10);
    const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];

    // Pre-load snapshot so Claude always has full context without needing a tool call
    const snapshotData = toolGetHealthSnapshot();
    const snapshotContext = `JACK'S CURRENT DATA (live from database):
- HRV: ${snapshotData.hrv_rmssd_ms || '--'} ms (${snapshotData.hrv_timestamp || 'unknown time'})
- Resting HR: ${snapshotData.resting_hr_bpm || '--'} bpm
- Steps today: ${snapshotData.steps_today || '--'}
- Active calories today: ${snapshotData.active_calories_today || '--'} kcal
- Exercise minutes today: ${snapshotData.exercise_minutes_today || '--'} min
- Sleep: ${snapshotData.sleep ? `${snapshotData.sleep.total} (deep: ${snapshotData.sleep.deep_min}min, REM: ${snapshotData.sleep.rem_min}min, efficiency: ${snapshotData.sleep.efficiency}%)` : '--'}
- SpO2: ${snapshotData.spo2_pct || '--'}%
- Weight: ${snapshotData.weight_kg || '--'} kg | Body fat: ${snapshotData.body_fat_pct || '--'}%
- Gut (7-day avg): pain ${snapshotData.gut_7day_avg?.pain || '--'}/10, bloat ${snapshotData.gut_7day_avg?.bloat || '--'}/10
- Workouts this week: ${snapshotData.workouts_this_week || 0}
- Supplements on file: ${Array.isArray(snapshotData.supplements_on_file) ? snapshotData.supplements_on_file.join(', ') : snapshotData.supplements_on_file}
- Lab results (blood/gut tests):
${Array.isArray(snapshotData.lab_results) ? snapshotData.lab_results.map(r => '  • ' + r).join('\n') : '  ' + snapshotData.lab_results}`;

    const systemPrompt = `You are JARVIS — Jack's personal AI health OS, modelled on Iron Man's AI.
Jack: 25yo male, 6'2" (188cm), ~100kg, lean bulking / performance optimisation focus.
Today: ${dayName} ${today}

${snapshotContext}

Your job:
1. Log anything Jack mentions about his health (food, gut, workouts, mood, supplements, body comp)
2. Answer health questions using the data above — you already have it, you don't need to ask for it
3. Respond like the real JARVIS — intelligent, dry, efficient. 1-3 sentences MAX unless asked for detail.

TOOL USE RULES — CRITICAL, FOLLOW EXACTLY:
- ANY mention of food, drink, eating, meals → IMMEDIATELY call log_diet for EACH item. No exceptions.
- Messages from voice transcriptions will be casual/rambly — extract every food item and log each one separately.
- If Jack says "I had X, Y and Z" → 3 separate log_diet calls. Don't bundle into one.
- Estimate calories/macros if not given — use common sense for portion sizes.
- If Jack corrects or fixes a food entry (e.g. "that was 0.34kg not 1.34kg") → call delete_diet_log to remove the wrong entry FIRST, THEN call log_diet with the correct values. Never just add a new entry without deleting the wrong one.
- If Jack asks about a trend or history → call get_recent_logs for that category
- If Jack asks about supplements / pills → use data above first, then get_recent_logs with category='supplement' if more detail needed
- Workout mentions → log_workout. Mood/gut mentions → log_mood / log_gut.
- You CAN and SHOULD call multiple tools in one turn.
- NEVER say "I don't have that data" — the data is RIGHT THERE in the system prompt above.
- NEVER just say "Systems nominal" when food/workout data was described — log it first.

BLOOD/LAB RESULTS — YOU HAVE THEM:
- All lab results are listed above under "Lab results". Reference them directly when asked.
- Key findings from April 2026 tests: H. pylori POSITIVE (treating), Omega-3 Index 5.01% (needs >8%), hs-CRP 0.19 (excellent), HbA1c 27 (optimal), Testosterone 19.1 nmol/L (solid), Vitamin D 77 nmol/L (good), eGFR 87 (borderline — likely creatine confounded).

RESPONSE STYLE:
- Dry wit, direct, never sycophantic. 1-3 sentences max.
- After logging food: confirm briefly + note if protein is on/off track
- Keep it tight. Jack doesn't want an essay.`;

    // Clean history — strip any tool messages, keep text only (last 10 turns)
    const cleanHistory = (history || [])
      .filter(h => h.role === 'user' || h.role === 'assistant')
      .map(h => ({ role: h.role, content: typeof h.content === 'string' ? h.content : JSON.stringify(h.content) }))
      .slice(-10);

    // Build message array for Claude
    const messages = [
      ...cleanHistory,
      { role: 'user', content: message }
    ];

    const logged = [];
    let iterations = 0;
    const MAX_ITERATIONS = 8;
    let finalResponse = '';

    // Claude tool-calling loop
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      let response;
      // Retry up to 3x on overload/rate limit
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await client.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 1024,
            system: systemPrompt,
            tools: CLAUDE_TOOLS,
            messages
          });
          break;
        } catch (e) {
          if ((e.status === 529 || e.status === 429) && attempt < 2) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 8000));
            continue;
          }
          throw e;
        }
      }

      if (response.stop_reason === 'tool_use') {
        // Add assistant message (contains text + tool_use blocks)
        messages.push({ role: 'assistant', content: response.content });

        // Execute all tool calls, collect results
        const toolResults = [];
        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          console.log(`[JARVIS] Tool: ${block.name}`, block.input);
          const fn = JARVIS_TOOL_MAP[block.name];
          let result;
          try {
            result = fn ? fn(block.input) : { error: `Unknown tool: ${block.name}` };
            if (result?.logged) logged.push(result.logged);
          } catch (e) {
            result = { error: e.message };
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result)
          });
        }

        // Feed results back as a user turn (Anthropic format)
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      if (response.stop_reason === 'end_turn') {
        finalResponse = response.content.find(b => b.type === 'text')?.text || '';
        break;
      }

      // Unexpected stop
      finalResponse = response.content.find(b => b.type === 'text')?.text || 'Systems nominal.';
      break;
    }

    if (!finalResponse) finalResponse = 'Processing complete.';
    if (logged.length > 0) console.log('[JARVIS] Logged:', logged.join(', '));

    res.json({ response: finalResponse, logged, actions: [] });

  } catch (e) {
    console.error('[CHAT] Error:', e.message);
    res.status(500).json({ error: e.message, response: 'Systems error. Try again.' });
  }
});

// ─── Telegram Bot Webhook ─────────────────────────────────────────────────────

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

// Per-chat conversation memory (persists across restarts via SQLite)
const chatMemory = new Map(); // chat_id → [{ role, content }, ...]

function getHistory(chat_id) {
  if (!chatMemory.has(chat_id)) {
    // Try to load from DB
    try {
      const row = db.getDb().prepare('SELECT history_json FROM telegram_memory WHERE chat_id = ?').get(String(chat_id));
      chatMemory.set(chat_id, row ? JSON.parse(row.history_json) : []);
    } catch { chatMemory.set(chat_id, []); }
  }
  return chatMemory.get(chat_id);
}

function saveHistory(chat_id, history) {
  chatMemory.set(chat_id, history);
  try {
    const json = JSON.stringify(history.slice(-20));
    db.getDb().exec(`CREATE TABLE IF NOT EXISTS telegram_memory (chat_id TEXT PRIMARY KEY, history_json TEXT, updated_at TEXT)`);
    db.getDb().prepare(`INSERT INTO telegram_memory (chat_id, history_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET history_json=excluded.history_json, updated_at=excluded.updated_at`)
      .run(String(chat_id), json, new Date().toISOString());
  } catch(e) { console.error('[TG] Memory save failed:', e.message); }
}

async function tgSend(chat_id, text, extra = {}) {
  const fetch = require('node-fetch');
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode: 'Markdown', ...extra })
    });
  } catch(e) { console.error('[TG] Send failed:', e.message); }
}

async function tgTyping(chat_id) {
  const fetch = require('node-fetch');
  try {
    await fetch(`${TELEGRAM_API}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, action: 'typing' })
    });
  } catch {}
}

async function tgSendPhoto(chat_id, filePath, caption = '') {
  const fetch = require('node-fetch');
  const fs = require('fs');
  const FormData = require('form-data');
  try {
    const form = new FormData();
    form.append('chat_id', String(chat_id));
    form.append('photo', fs.createReadStream(filePath));
    if (caption) form.append('caption', caption);
    form.append('parse_mode', 'Markdown');
    await fetch(`${TELEGRAM_API}/sendPhoto`, { method: 'POST', body: form });
  } catch (e) { console.error('[TG] sendPhoto failed:', e.message); }
}

async function tgAnswer(callback_query_id) {
  const fetch = require('node-fetch');
  try {
    await fetch(`${TELEGRAM_API}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id })
    });
  } catch {}
}

async function transcribeVoice(file_id) {
  const fetch = require('node-fetch');
  // Get file path from Telegram
  const fileInfo = await fetch(`${TELEGRAM_API}/getFile?file_id=${file_id}`).then(r => r.json());
  if (!fileInfo.ok) throw new Error('Could not get file info');
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${filePath}`;

  // Download audio
  const audioRes = await fetch(fileUrl);
  const audioBuffer = await audioRes.buffer();

  // Send to Whisper
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
  form.append('model', 'whisper-1');
  form.append('language', 'en');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, ...form.getHeaders() },
    body: form
  }).then(r => r.json());

  if (whisperRes.error) throw new Error(whisperRes.error.message);
  return whisperRes.text;
}

async function handleJarvisMessage(chat_id, userText, from = 'Jack') {
  const fetch = require('node-fetch');
  const history = getHistory(chat_id);

  // JARVIS now queries live data via tools — no need to pre-inject snapshot
  const chatRes = await fetch(`http://localhost:${process.env.PORT || 3000}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: userText, history })
  }).then(r => r.json());

  const reply = chatRes.response || 'Understood.';
  const logged = chatRes.logged || [];

  // Update memory
  history.push({ role: 'user', content: userText });
  history.push({ role: 'assistant', content: reply });
  saveHistory(chat_id, history.slice(-20));

  // Format Telegram response
  let msg = reply;
  if (logged.length > 0) {
    msg += '\n\n' + logged.map(l => `✅ _${l}_`).join('\n');
  }

  // Quick action keyboard after logging
  const keyboard = logged.length > 0 ? {
    inline_keyboard: [[
      { text: '📊 View Status', callback_data: 'status' },
      { text: '💬 More detail', callback_data: 'more' }
    ]]
  } : undefined;

  await tgSend(chat_id, msg, keyboard ? { reply_markup: keyboard } : {});
  console.log(`[TG] ${from}: "${userText.slice(0,60)}" → logged: ${logged.join(', ') || 'none'}`);
}

app.post('/api/telegram', async (req, res) => {
  res.sendStatus(200);

  try {
    const update = req.body;

    // Handle callback_query (inline button presses)
    if (update.callback_query) {
      const cq = update.callback_query;
      await tgAnswer(cq.id);
      const chat_id = cq.message.chat.id;

      if (cq.data === 'status') {
        const fetch = require('node-fetch');
        const snap = await fetch(`http://localhost:3000/api/dashboard`).then(r => r.json());
        const s = snap.snapshot || {};
        const act = s.activity || {};
        const score = snap.score?.overall || '--';
        const pillars = snap.score?.pillars || {};
        const pillarEmoji = { recovery: '💤', physical: '🏋️', metabolic: '🔥', gut: '🫁', longevity: '🧬', cognitive: '🧠', hormonal: '⚗️', mind: '🧘' };
        let pillarStr = Object.entries(pillars).map(([k,v]) => `${pillarEmoji[k]||'•'} ${k}: ${v||'--'}`).join('\n');

        await tgSend(chat_id,
          `*⚡ JARVIS STATUS — ${new Date().toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'})}*\n\n` +
          `🎯 *Superhuman Score: ${score}/100*\n\n` +
          `💓 Resting HR: *${s.resting_hr||'--'} bpm*\n` +
          `🫀 HRV: *${s.hrv||'--'} ms*\n` +
          `😴 Sleep: *${s.sleep?.total_minutes ? Math.floor(s.sleep.total_minutes/60)+'h '+s.sleep.total_minutes%60+'m' : '--'}*\n` +
          `👟 Steps: *${act.steps?.toLocaleString()||'--'}*\n` +
          `🩺 SpO2: *${s.spo2||'--'}%*\n\n` +
          `*PILLARS*\n${pillarStr}\n\n` +
          `_[Open Dashboard](https://jarvis.rockellstech.com)_`
        );
      } else if (cq.data === 'more') {
        await tgSend(chat_id, `Tell me more — what else happened today? Training, food, how you're feeling?`);
      }
      return;
    }

    const message = update.message;
    if (!message) return;

    const chat_id = message.chat.id;
    const from = message.from?.first_name || 'Jack';

    // /start
    if (message.text === '/start') {
      saveHistory(chat_id, []); // Reset memory on /start
      await tgSendPhoto(chat_id,
        path.join(__dirname, 'public', 'jarvis-logo.png'),
        `*J.A.R.V.I.S. ONLINE* ⚡`
      );
      await tgSend(chat_id,
        `Good. All systems operational, ${from}.\n\n` +
        `Just talk to me naturally — I'll log everything:\n` +
        `• _"had chicken and rice for lunch"_ → logs diet\n` +
        `• _"feeling bloated 6/10 today"_ → logs gut\n` +
        `• _"45 min zone 2 bike session"_ → logs workout\n` +
        `• _"weighed 99.2kg this morning"_ → logs body comp\n\n` +
        `🎙 *Voice messages work too.*\n\n` +
        `Commands: /status /summary /clear`,
        { reply_markup: { inline_keyboard: [[{ text: '📊 Check Status Now', callback_data: 'status' }]] } }
      );
      return;
    }

    // /status
    if (message.text === '/status') {
      await tgTyping(chat_id);
      // Trigger via callback handler
      const fakeUpdate = { callback_query: { id: 'manual', data: 'status', message: { chat: { id: chat_id } } } };
      req.body = fakeUpdate;
      // Direct call
      const fetch = require('node-fetch');
      const snap = await fetch(`http://localhost:3000/api/dashboard`).then(r => r.json());
      const s = snap.snapshot || {};
      const act = s.activity || {};
      await tgSend(chat_id,
        `*⚡ JARVIS STATUS*\n\n` +
        `🎯 Score: *${snap.score?.overall||'--'}/100*\n` +
        `💓 HR: *${s.resting_hr||'--'} bpm* | 🫀 HRV: *${s.hrv||'--'} ms*\n` +
        `😴 Sleep: *${s.sleep?.total_minutes ? Math.floor(s.sleep.total_minutes/60)+'h '+s.sleep.total_minutes%60+'m' : '--'}*\n` +
        `👟 Steps: *${act.steps?.toLocaleString()||'--'}* | 🩺 SpO2: *${s.spo2||'--'}%*\n\n` +
        `_[Open Dashboard](https://jarvis.rockellstech.com)_`
      );
      return;
    }

    // /summary — weekly overview
    if (message.text === '/summary') {
      await tgTyping(chat_id);
      const fetch = require('node-fetch');
      const stats = await fetch(`http://localhost:3000/api/weekly-stats`).then(r => r.json()).catch(() => null);
      await tgSend(chat_id, `*Weekly summary coming soon* — check the full dashboard at [jarvis.rockellstech.com](https://jarvis.rockellstech.com)`);
      return;
    }

    // /clear — reset memory
    if (message.text === '/clear') {
      saveHistory(chat_id, []);
      await tgSend(chat_id, `Memory cleared. Fresh start, ${from}.`);
      return;
    }

    // Skip other commands
    if (message.text?.startsWith('/')) return;

    await tgTyping(chat_id);

    // Voice message → transcribe with Whisper
    if (message.voice || message.audio) {
      const file_id = (message.voice || message.audio).file_id;
      try {
        await tgSend(chat_id, `🎙 _Transcribing..._`);
        const transcript = await transcribeVoice(file_id);
        await tgSend(chat_id, `🎙 _"${transcript}"_`);
        await handleJarvisMessage(chat_id, transcript, from);
      } catch (e) {
        console.error('[TG] Voice transcription failed:', e.message);
        await tgSend(chat_id, `⚠️ Couldn't transcribe that. Try typing it instead.`);
      }
      return;
    }

    // Regular text message
    if (message.text) {
      await handleJarvisMessage(chat_id, message.text, from);
    }

  } catch (e) {
    console.error('[TELEGRAM] Error:', e.message);
  }
});

// ─── Telegram daily proactive reminders ──────────────────────────────────────
// Runs at 8am and 9pm to check in with Jack

function getTelegramChatIds() {
  try {
    db.getDb().exec(`CREATE TABLE IF NOT EXISTS telegram_memory (chat_id TEXT PRIMARY KEY, history_json TEXT, updated_at TEXT)`);
    return db.getDb().prepare('SELECT chat_id FROM telegram_memory').all().map(r => r.chat_id);
  } catch { return []; }
}

// ─── Watch Push Monitor — alert if no push in 65 minutes ─────────────────────

app.get('/api/watch/status', (req, res) => {
  const now = Date.now();
  let effectivePush = lastHealthPush;

  // If in-memory value seems stale (e.g. after restart), cross-check DB
  if (!effectivePush || (now - effectivePush) > 65 * 60 * 1000) {
    try {
      const database = db.getDb();
      const persisted = database.prepare(`SELECT value FROM settings WHERE key = 'last_health_push'`).get();
      if (persisted?.value) {
        const dbVal = parseInt(persisted.value);
        if (!effectivePush || dbVal > effectivePush) {
          effectivePush = dbVal;
          lastHealthPush = dbVal; // sync in-memory too
        }
      }
    } catch(_) {}
  }

  const minutesSince = effectivePush ? Math.round((now - effectivePush) / 60000) : null;
  const lastPushISO = effectivePush ? new Date(effectivePush).toISOString() : null;
  res.json({
    last_push: lastPushISO,
    minutes_since: minutesSince,
    status: minutesSince === null ? 'unknown'
           : minutesSince <= 65 ? 'ok'
           : minutesSince <= 120 ? 'stale'
           : 'offline',
  });
});

// Check every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  if (!lastHealthPush) return; // never received a push — skip until first one arrives

  const minutesSince = (Date.now() - lastHealthPush) / 60000;
  const minutesSinceAlert = watchAlertSentAt ? (Date.now() - watchAlertSentAt) / 60000 : Infinity;

  if (minutesSince > 65 && minutesSinceAlert > 120) {
    const mins = Math.round(minutesSince);
    const lastStr = new Date(lastHealthPush).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
    const chatIds = getTelegramChatIds();
    for (const chat_id of chatIds) {
      await tgSend(chat_id,
        `⚠️ *Watch sync stalled*\n\nNo data from Apple Watch in *${mins} minutes* (last push: ${lastStr} UTC).\n\nOpen *Health Auto Export* on iPhone → tap sync to reconnect.`
      );
    }
    watchAlertSentAt = Date.now();
    console.log(`[WATCH] Stale alert sent — ${mins}m since last push`);
  }
});

// 8:00am morning check-in
cron.schedule('0 8 * * *', async () => {
  const chatIds = getTelegramChatIds();
  for (const chat_id of chatIds) {
    await tgSend(chat_id,
      `*⚡ Good morning.* JARVIS online.\n\nQuick check-in — how did you sleep, and what's the weight today?\n\nJust reply naturally.`,
      { reply_markup: { inline_keyboard: [[{ text: '📊 View Status', callback_data: 'status' }]] } }
    );
  }
});

// 9:00pm evening check-in
cron.schedule('0 21 * * *', async () => {
  const chatIds = getTelegramChatIds();
  for (const chat_id of chatIds) {
    await tgSend(chat_id,
      `*🌙 Evening check-in.* How was today?\n\nGut symptoms? What did you eat? Anything worth noting for the record?`
    );
  }
});

// Sunday 20:00 UTC — weekly performance report
cron.schedule('0 20 * * 0', async () => {
  const chatIds = getTelegramChatIds();
  if (!chatIds.length) return;

  console.log('[JARVIS] Generating weekly report...');
  try {
    const database = db.getDb();
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    const hrv = database.prepare(`SELECT AVG(rmssd) as avg, MIN(rmssd) as min, MAX(rmssd) as max FROM hrv WHERE substr(timestamp,1,10) >= ?`).get(weekAgo);
    const activity = database.prepare(`SELECT SUM(steps) as steps, SUM(active_calories) as kcal, SUM(exercise_minutes) as exmin FROM activity WHERE date >= ?`).get(weekAgo);
    const workouts = database.prepare(`SELECT COUNT(*) as n, SUM(duration_minutes) as mins FROM workouts WHERE date >= ?`).get(weekAgo);
    const sleep = database.prepare(`SELECT AVG(total_minutes) as avg_min, AVG(deep_minutes) as avg_deep, AVG(efficiency) as avg_eff FROM sleep WHERE date >= ? AND total_minutes > 60`).get(weekAgo);
    const gut = database.prepare(`SELECT AVG(pain_severity) as avg_pain, AVG(gut_score) as avg_score FROM gut_logs WHERE date >= ?`).get(weekAgo);
    const supplements = database.prepare(`SELECT COUNT(DISTINCT date) as days_logged FROM supplements WHERE date >= ?`).get(weekAgo);
    const tl = calcTrainingLoad(database);
    const readiness = calcReadinessScore(database);

    const weekData = { hrv, activity, workouts, sleep, gut, supplements, training_load: tl, readiness };
    const result = await jarvis.generateWeeklyReport(weekData);

    if (result?.content) {
      for (const chat_id of chatIds) {
        await tgSend(chat_id, `*📊 Weekly Performance Report*\n\n${result.content}`);
      }
      console.log('[JARVIS] Weekly report sent.');
    }
  } catch (e) {
    console.error('[JARVIS] Weekly report failed:', e.message);
  }
});

// ─── Serve frontend ──────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║          JARVIS — PERSONAL HEALTH OS      ║
║                                           ║
║  Dashboard: http://localhost:${PORT}         ║
║  Webhook:   POST /api/health              ║
╚═══════════════════════════════════════════╝
  `);

  // Initialize DB and seed on startup
  db.getDb();
  console.log('[DB] Database ready at health.db');

  // Initialise watch monitor from last known DB record
  initWatchMonitor();
});

module.exports = app;
