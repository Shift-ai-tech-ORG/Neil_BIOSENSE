/**
 * vitals.js — Apple Watch vitals section
 */

async function loadVitals() {
  const data = await api('/api/vitals?days=30');
  if (!data) return;

  const { hrv, sleep, activity, vitals, spo2 } = data;

  // HRV stat
  if (hrv && hrv.length > 0) {
    const latest = hrv[hrv.length - 1]?.rmssd;
    const avg = hrv.reduce((a, b) => a + (b.rmssd || 0), 0) / hrv.length;
    const el = document.getElementById('v-hrv');
    if (el && latest) animateNumber(el, Math.round(latest));

    const trendEl = document.getElementById('v-hrv-trend');
    if (trendEl && latest && avg) {
      const pct = Math.round(((latest - avg) / avg) * 100);
      trendEl.textContent = `vs 30-day baseline: ${pct > 0 ? '+' : ''}${pct}%`;
      trendEl.className = `metric-trend ${pct >= 10 ? 'trend-up' : pct <= -10 ? 'trend-down' : 'trend-stable'}`;
    }
  }

  // Sleep stat
  if (sleep && sleep.length > 0) {
    const latest = sleep[0];
    const hrs = (latest.total_minutes || 0) / 60;
    const el = document.getElementById('v-sleep');
    if (el) el.textContent = hrs.toFixed(1);

    const trendEl = document.getElementById('v-sleep-trend');
    if (trendEl) {
      trendEl.textContent = `Deep: ${latest.deep_minutes || 0}min · REM: ${latest.rem_minutes || 0}min · Eff: ${latest.efficiency || '?'}%`;
    }
  }

  // Resting HR stat (from vitals)
  const latestVitals = vitals && vitals.length > 0 ? vitals[vitals.length - 1] : null;
  if (latestVitals?.resting_hr) {
    const el = document.getElementById('v-rhr');
    if (el) animateNumber(el, Math.round(latestVitals.resting_hr));
  }

  // VO2 max
  const latestVo2 = vitals && vitals.length > 0
    ? vitals.slice().reverse().find(v => v.vo2max)?.vo2max
    : null;
  if (latestVo2) {
    const el = document.getElementById('v-vo2');
    if (el) el.textContent = latestVo2.toFixed(1);
  }

  // SpO2 latest
  if (spo2 && spo2.length > 0) {
    const latestSpO2 = spo2[spo2.length - 1];
    const el = document.getElementById('v-spo2');
    if (el) el.textContent = latestSpO2.value ? latestSpO2.value.toFixed(1) : '--';
  }

  // Activity rings (today)
  const todayActivity = activity && activity.length > 0 ? activity[activity.length - 1] : null;
  if (todayActivity) {
    const moveEl = document.getElementById('ring-move-val');
    const exEl = document.getElementById('ring-ex-val');
    const standEl = document.getElementById('ring-stand-val');

    if (moveEl) animateNumber(moveEl, Math.round(todayActivity.active_calories || 0));
    if (exEl) animateNumber(exEl, Math.round(todayActivity.exercise_minutes || 0));
    if (standEl) standEl.textContent = todayActivity.stand_hours || 0;

    animateRing('ring-move', todayActivity.active_calories || 0, 600, 327);
    animateRing('ring-exercise', todayActivity.exercise_minutes || 0, 30, 239);
    animateRing('ring-stand', todayActivity.stand_hours || 0, 12, 151);
  }

  // Render charts
  renderHRVChart(hrv || []);
  renderHypnogram(sleep || []);
  renderRHRChart(vitals || []);
  renderSpO2Chart(spo2 || []);
}

function animateRing(id, current, target, circumference) {
  const ring = document.getElementById(id);
  if (!ring) return;
  const progress = Math.min(current / target, 1);
  const offset = circumference - progress * circumference;
  setTimeout(() => {
    ring.style.strokeDashoffset = offset;
  }, 200);
}

window.loadVitals = loadVitals;
