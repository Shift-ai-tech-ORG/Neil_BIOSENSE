/**
 * jarvis.js — Claude-powered AI layer
 * Daily briefings, weekly reports, anomaly detection, biological age
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 400) {
  const client = getClient();
  if (!client) return null;
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    return {
      content: msg.content?.[0]?.text || null,
      tokens: msg.usage?.input_tokens + msg.usage?.output_tokens || 0,
    };
  } catch (e) {
    console.error('[JARVIS] Claude call failed:', e.message);
    return null;
  }
}

async function generateDailyBriefing(snapshot) {
  const system = `You are JARVIS — Jack's personal AI health intelligence system. Jack is 25 years old, athletic male, 6'2" (~100kg, targeting 93kg at 10% BF). He tracks everything for superhuman longevity and peak performance. Speak like a brilliant precision health analyst: direct, data-driven, occasionally motivating. Never sycophantic. 3–4 sentences max. Reference specific numbers. Focus on: recovery status, readiness to train, one priority action for today.`;
  const user = buildSnapshotPrompt(snapshot);
  return callClaude(system, user, 300);
}

async function generateWeeklyReport(weekData) {
  const system = `You are JARVIS — Jack's personal health AI. Generate a weekly performance debrief for Jack (25yr male, optimizing for superhuman longevity: VO2max, HRV, body comp, gut health, cognitive performance). Be precise with numbers. Identify the #1 pattern from this week. Recommend one protocol experiment for next week. 6–8 sentences.`;
  const user = `Weekly data summary:\n${JSON.stringify(weekData, null, 2)}`;
  return callClaude(system, user, 600);
}

async function generateCorrelationInsight(correlationData) {
  const system = `You are JARVIS — Jack's health AI. Analyse the correlation data and give one clear, actionable insight. What does the pattern mean? What should Jack change or continue? 2–3 sentences only.`;
  const user = `Correlation analysis:\n${JSON.stringify(correlationData, null, 2)}`;
  return callClaude(system, user, 200);
}

function buildSnapshotPrompt(snapshot) {
  const parts = [];
  parts.push(`Date: ${snapshot.date}`);

  if (snapshot.hrv) {
    const pct = snapshot.hrv_baseline
      ? Math.round(((snapshot.hrv - snapshot.hrv_baseline) / snapshot.hrv_baseline) * 100)
      : null;
    parts.push(`HRV: ${Math.round(snapshot.hrv)}ms rmssd${pct !== null ? ` (${pct > 0 ? '+' : ''}${pct}% vs 30-day baseline of ${Math.round(snapshot.hrv_baseline)}ms)` : ''}`);
  }

  if (snapshot.resting_hr) parts.push(`Resting HR: ${Math.round(snapshot.resting_hr)} bpm`);
  if (snapshot.spo2) parts.push(`SpO2: ${snapshot.spo2}%`);

  if (snapshot.readiness) {
    parts.push(`Readiness score: ${snapshot.readiness.score}/100 (${snapshot.readiness.label})`);
  }

  if (snapshot.sleep) {
    const hrs = Math.round((snapshot.sleep.total_minutes || 0) / 60 * 10) / 10;
    parts.push(`Last night: ${hrs}h sleep, ${snapshot.sleep.deep_minutes || 0}min deep, ${snapshot.sleep.rem_minutes || 0}min REM, ${snapshot.sleep.efficiency || '?'}% efficiency`);
  }

  if (snapshot.activity) {
    parts.push(`Activity: ${snapshot.activity.steps?.toLocaleString() || 0} steps, ${Math.round(snapshot.activity.active_calories || 0)} kcal active, ${snapshot.activity.exercise_minutes || 0}min exercise, ${snapshot.activity.distance_km ? snapshot.activity.distance_km.toFixed(1) + 'km' : ''}`);
  }

  if (snapshot.training_load) {
    const tl = snapshot.training_load;
    parts.push(`Training load: fitness ${tl.ctl} · fatigue ${tl.atl} · form ${tl.tsb > 0 ? '+' : ''}${tl.tsb} (${tl.status})`);
  }

  if (snapshot.gut) {
    parts.push(`Gut: pain ${snapshot.gut.pain_severity || 0}/10, bloat ${snapshot.gut.bloat_level || 0}/10, Bristol ${snapshot.gut.bristol_type || '?'}`);
  }

  return parts.join('\n');
}

// ─── Readiness Score ─────────────────────────────────────────────────────────
// Combines HRV vs baseline, sleep quality, resting HR trend into 0-100 score

function calcReadinessScore(db) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // HRV today vs 30-day baseline
  const hrvToday = db.prepare(`SELECT AVG(rmssd) as v FROM hrv WHERE substr(timestamp,1,10) = ?`).get(today)
    || db.prepare(`SELECT AVG(rmssd) as v FROM hrv WHERE substr(timestamp,1,10) = ?`).get(yesterday);
  const hrvBaseline = db.prepare(`SELECT AVG(rmssd) as v FROM hrv WHERE substr(timestamp,1,10) >= date('now','-30 days')`).get();

  // Resting HR today vs 14-day baseline
  const rhrToday = db.prepare(`SELECT resting_hr as v FROM vitals WHERE resting_hr IS NOT NULL AND date = ? ORDER BY id DESC LIMIT 1`).get(today)
    || db.prepare(`SELECT resting_hr as v FROM vitals WHERE resting_hr IS NOT NULL AND date = ? ORDER BY id DESC LIMIT 1`).get(yesterday);
  const rhrBaseline = db.prepare(`SELECT AVG(resting_hr) as v FROM vitals WHERE resting_hr IS NOT NULL AND date >= date('now','-14 days')`).get();

  // Last night's sleep
  const sleep = db.prepare(`SELECT * FROM sleep WHERE total_minutes > 60 ORDER BY date DESC LIMIT 1`).get();

  let score = 50;
  let factors = [];

  // HRV component (35 pts max)
  if (hrvToday?.v && hrvBaseline?.v) {
    const ratio = hrvToday.v / hrvBaseline.v;
    if (ratio >= 1.20)      { score += 35; factors.push({ key: 'HRV', delta: '+35', note: `${Math.round(hrvToday.v)}ms (+${Math.round((ratio-1)*100)}% above baseline)` }); }
    else if (ratio >= 1.10) { score += 25; factors.push({ key: 'HRV', delta: '+25', note: `${Math.round(hrvToday.v)}ms (+${Math.round((ratio-1)*100)}% above baseline)` }); }
    else if (ratio >= 1.00) { score += 15; factors.push({ key: 'HRV', delta: '+15', note: `${Math.round(hrvToday.v)}ms (at baseline)` }); }
    else if (ratio >= 0.90) { score += 0;  factors.push({ key: 'HRV', delta: '0',   note: `${Math.round(hrvToday.v)}ms (${Math.round((1-ratio)*100)}% below baseline)` }); }
    else if (ratio >= 0.80) { score -= 10; factors.push({ key: 'HRV', delta: '-10', note: `${Math.round(hrvToday.v)}ms (${Math.round((1-ratio)*100)}% suppressed)` }); }
    else                    { score -= 20; factors.push({ key: 'HRV', delta: '-20', note: `${Math.round(hrvToday.v)}ms (severely suppressed)` }); }
  }

  // RHR component (20 pts max)
  if (rhrToday?.v && rhrBaseline?.v) {
    const diff = rhrToday.v - rhrBaseline.v;
    if (diff <= -3)      { score += 20; factors.push({ key: 'RHR', delta: '+20', note: `${Math.round(rhrToday.v)}bpm (low — great recovery)` }); }
    else if (diff <= 0)  { score += 10; factors.push({ key: 'RHR', delta: '+10', note: `${Math.round(rhrToday.v)}bpm (normal)` }); }
    else if (diff <= 3)  { score += 0;  factors.push({ key: 'RHR', delta: '0',   note: `${Math.round(rhrToday.v)}bpm (+${diff.toFixed(0)} above baseline)` }); }
    else if (diff <= 6)  { score -= 10; factors.push({ key: 'RHR', delta: '-10', note: `${Math.round(rhrToday.v)}bpm (elevated — stress/illness signal)` }); }
    else                 { score -= 15; factors.push({ key: 'RHR', delta: '-15', note: `${Math.round(rhrToday.v)}bpm (high — recovery priority)` }); }
  }

  // Sleep component (30 pts max)
  if (sleep) {
    const hrs = (sleep.total_minutes || 0) / 60;
    const eff = sleep.efficiency || 0;
    const deep = sleep.deep_minutes || 0;

    // Sleep duration
    if (hrs >= 8)        score += 10;
    else if (hrs >= 7)   score += 7;
    else if (hrs >= 6)   score += 2;
    else                 score -= 10;

    // Sleep efficiency
    if (eff >= 90)       score += 10;
    else if (eff >= 85)  score += 6;
    else if (eff >= 75)  score += 2;
    else                 score -= 5;

    // Deep sleep
    if (deep >= 90)      score += 10;
    else if (deep >= 60) score += 5;
    else if (deep >= 30) score += 2;

    factors.push({ key: 'Sleep', delta: '', note: `${hrs.toFixed(1)}h · ${deep}min deep · ${eff}% efficiency` });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let label, advice, color;
  if (score >= 85)      { label = 'Peak'; advice = 'High-intensity training — push hard today'; color = '#00e5ff'; }
  else if (score >= 70) { label = 'High'; advice = 'Train at full effort — you\'re well recovered'; color = '#00d4aa'; }
  else if (score >= 55) { label = 'Moderate'; advice = 'Normal training — avoid PRs, stay in zone'; color = '#ffaa00'; }
  else if (score >= 40) { label = 'Low'; advice = 'Reduce intensity — focus on mobility or zone 1'; color = '#ff8800'; }
  else                  { label = 'Recovery'; advice = 'Rest day — body is signalling high stress load'; color = '#ff2244'; }

  return { score, label, advice, color, factors };
}

// ─── Training Load (CTL / ATL / TSB) ────────────────────────────────────────
// TSS = duration_minutes * intensity_factor (where IF is derived from HR zones)
// CTL = 42-day exponentially weighted avg of daily TSS (fitness)
// ATL = 7-day exponentially weighted avg of daily TSS (fatigue)
// TSB = CTL - ATL (form)

function calcTrainingLoad(db) {
  // Get last 90 days of workouts
  const workouts = db.prepare(`
    SELECT date, duration_minutes, avg_hr, max_hr, type,
           hr_zone1_minutes, hr_zone2_minutes, hr_zone3_minutes, hr_zone4_minutes, hr_zone5_minutes
    FROM workouts WHERE date >= date('now', '-90 days') ORDER BY date ASC
  `).all();

  // Calculate TSS per workout using HR-based intensity factor
  // IF = avg_hr / threshold_hr (threshold ~175 for Jack at 25 → max ~195)
  const THRESHOLD_HR = 175;

  const dailyTSS = {};
  for (const w of workouts) {
    if (!w.duration_minutes || w.duration_minutes < 5) continue;

    let tss;
    if (w.hr_zone3_minutes || w.hr_zone4_minutes || w.hr_zone5_minutes) {
      // Use zone data if available
      const z1 = (w.hr_zone1_minutes || 0) * 0.25;
      const z2 = (w.hr_zone2_minutes || 0) * 0.55;
      const z3 = (w.hr_zone3_minutes || 0) * 0.80;
      const z4 = (w.hr_zone4_minutes || 0) * 1.05;
      const z5 = (w.hr_zone5_minutes || 0) * 1.20;
      const totalZoneMin = z1 + z2 + z3 + z4 + z5;
      const avgIF = totalZoneMin / w.duration_minutes;
      tss = Math.round((w.duration_minutes / 60) * avgIF * avgIF * 100);
    } else if (w.avg_hr && w.avg_hr > 0) {
      const IF = w.avg_hr / THRESHOLD_HR;
      tss = Math.round((w.duration_minutes / 60) * IF * IF * 100);
    } else {
      // No HR data — estimate from workout type
      const t = (w.type || '').toLowerCase();
      const baseIF = t.includes('strength') || t.includes('weight') ? 0.65
                   : t.includes('zone 2') || t.includes('zone2') ? 0.60
                   : t.includes('hiit') || t.includes('interval') ? 0.90
                   : t.includes('run') ? 0.75 : 0.65;
      tss = Math.round((w.duration_minutes / 60) * baseIF * baseIF * 100);
    }

    if (!dailyTSS[w.date]) dailyTSS[w.date] = 0;
    dailyTSS[w.date] += tss;
  }

  // Build 90-day array and compute exponentially weighted CTL/ATL
  const today = new Date();
  let ctl = 0; // chronic training load (42-day)
  let atl = 0; // acute training load (7-day)
  const ctlFactor = 1 / 42;
  const atlFactor = 1 / 7;

  const timeline = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    const tss = dailyTSS[ds] || 0;

    ctl = ctl + ctlFactor * (tss - ctl);
    atl = atl + atlFactor * (tss - atl);

    timeline.push({ date: ds, tss, ctl: Math.round(ctl), atl: Math.round(atl), tsb: Math.round(ctl - atl) });
  }

  const latest = timeline[timeline.length - 1];
  const tsb = latest.tsb;

  let status;
  if (tsb >= 15)       status = 'Peak Form';
  else if (tsb >= 5)   status = 'Fresh';
  else if (tsb >= -5)  status = 'Optimal Training';
  else if (tsb >= -15) status = 'Build Phase';
  else if (tsb >= -25) status = 'Heavy Load';
  else                 status = 'Overreaching';

  return {
    ctl: latest.ctl,
    atl: latest.atl,
    tsb: tsb,
    status,
    timeline: timeline.slice(-42), // last 42 days for chart
  };
}

// ─── Biological Age Estimate ─────────────────────────────────────────────────
// Based on VO2max, HRV, Resting HR, Body Fat % vs norms for age 25 male
// Each metric gives a "physiological age" → average for bio age estimate

function calcBiologicalAge(db) {
  const JACK_AGE = 25;

  const vo2 = db.prepare(`SELECT MAX(vo2max) as v FROM vitals WHERE date >= date('now','-90 days') AND vo2max > 0`).get();
  const hrv = db.prepare(`SELECT AVG(rmssd) as v FROM hrv WHERE substr(timestamp,1,10) >= date('now','-30 days')`).get();
  const rhr = db.prepare(`SELECT AVG(resting_hr) as v FROM vitals WHERE resting_hr IS NOT NULL AND date >= date('now','-14 days')`).get();
  const body = db.prepare(`SELECT body_fat_pct as v FROM body_comp ORDER BY date DESC LIMIT 1`).get();

  const components = [];

  // VO2max → physiological age
  // Male norms: Excellent 25yr = 52+, Superior = 46+, Good = 42+, Average = 37+, Poor < 37
  if (vo2?.v) {
    let physAge;
    if (vo2.v >= 58)      physAge = 18;
    else if (vo2.v >= 52) physAge = 20;
    else if (vo2.v >= 47) physAge = 23;
    else if (vo2.v >= 42) physAge = 27;
    else if (vo2.v >= 37) physAge = 32;
    else                  physAge = 38;
    components.push({ metric: 'VO₂ max', value: `${vo2.v.toFixed(1)} mL/kg/min`, physAge, weight: 3 });
  }

  // HRV rmssd → physiological age (25yr male avg ~55ms)
  if (hrv?.v) {
    let physAge;
    if (hrv.v >= 90)      physAge = 18;
    else if (hrv.v >= 70) physAge = 21;
    else if (hrv.v >= 55) physAge = 24;
    else if (hrv.v >= 40) physAge = 30;
    else if (hrv.v >= 30) physAge = 37;
    else                  physAge = 44;
    components.push({ metric: 'HRV (rmssd)', value: `${Math.round(hrv.v)}ms`, physAge, weight: 2 });
  }

  // Resting HR → physiological age (25yr male avg ~62bpm)
  if (rhr?.v) {
    let physAge;
    if (rhr.v <= 45)      physAge = 18;
    else if (rhr.v <= 50) physAge = 21;
    else if (rhr.v <= 58) physAge = 24;
    else if (rhr.v <= 65) physAge = 30;
    else if (rhr.v <= 72) physAge = 36;
    else                  physAge = 42;
    components.push({ metric: 'Resting HR', value: `${Math.round(rhr.v)} bpm`, physAge, weight: 2 });
  }

  // Body fat → physiological age (25yr male optimal 10-15%)
  if (body?.v) {
    let physAge;
    if (body.v <= 10)     physAge = 19;
    else if (body.v <= 13) physAge = 22;
    else if (body.v <= 17) physAge = 25;
    else if (body.v <= 22) physAge = 30;
    else if (body.v <= 27) physAge = 36;
    else                  physAge = 42;
    components.push({ metric: 'Body Fat', value: `${body.v.toFixed(1)}%`, physAge, weight: 1 });
  }

  if (components.length === 0) return null;

  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const bioAge = Math.round(components.reduce((a, c) => a + c.physAge * c.weight, 0) / totalWeight);
  const delta = JACK_AGE - bioAge; // positive = younger than chronological age

  return {
    bio_age: bioAge,
    chronological_age: JACK_AGE,
    delta,
    components,
    status: delta >= 5 ? 'Excellent' : delta >= 2 ? 'Above Average' : delta >= -2 ? 'Average' : 'Needs Work',
  };
}

function checkAnomalies(db) {
  const alerts = [];

  const recentVitals = db.prepare(`
    SELECT date, AVG(resting_hr) as rhr FROM vitals
    WHERE date >= date('now', '-5 days') AND resting_hr IS NOT NULL
    GROUP BY date ORDER BY date DESC
  `).all();

  if (recentVitals.length >= 3) {
    const baseline = db.prepare(`SELECT AVG(resting_hr) as avg FROM vitals WHERE date >= date('now','-30 days') AND resting_hr IS NOT NULL`).get();
    const elevated = recentVitals.slice(0, 3).filter(r => baseline?.avg && r.rhr >= baseline.avg + 5);
    if (elevated.length >= 3) {
      alerts.push({
        type: 'rhr_elevated',
        severity: 'warning',
        message: `Resting HR elevated ≥5bpm above baseline for 3+ consecutive days — illness, overtraining, or high stress. Reduce training intensity.`,
      });
    }
  }

  const recentHRV = db.prepare(`
    SELECT substr(timestamp,1,10) as date, AVG(rmssd) as rmssd FROM hrv
    WHERE substr(timestamp,1,10) >= date('now', '-5 days')
    GROUP BY substr(timestamp,1,10) ORDER BY date DESC
  `).all();

  if (recentHRV.length >= 3) {
    const baseline = db.prepare(`SELECT AVG(rmssd) as avg FROM hrv WHERE substr(timestamp,1,10) >= date('now','-30 days')`).get();
    const suppressed = recentHRV.slice(0, 3).filter(r => baseline?.avg && r.rmssd < baseline.avg * 0.85);
    if (suppressed.length >= 3) {
      alerts.push({
        type: 'hrv_suppressed',
        severity: 'warning',
        message: `HRV >15% below 30-day baseline for 3+ consecutive days — sustained recovery deficit. Prioritise sleep, reduce intensity, check stress.`,
      });
    }
  }

  const recentGut = db.prepare(`
    SELECT date, AVG(pain_severity) as severity FROM gut_logs
    WHERE date >= date('now', '-5 days')
    GROUP BY date ORDER BY date DESC
  `).all();

  if (recentGut.length >= 3) {
    const declining = recentGut[0].severity > recentGut[1].severity && recentGut[1].severity > recentGut[2].severity;
    if (declining && recentGut[0].severity >= 3) {
      alerts.push({
        type: 'gut_declining',
        severity: 'alert',
        message: `Gut symptoms worsening for 3+ consecutive days. Review last 72hrs of food — high-FODMAP trigger likely. Consider elimination protocol.`,
      });
    }
  }

  return alerts;
}

module.exports = {
  generateDailyBriefing,
  generateWeeklyReport,
  generateCorrelationInsight,
  buildSnapshotPrompt,
  checkAnomalies,
  calcReadinessScore,
  calcTrainingLoad,
  calcBiologicalAge,
};
