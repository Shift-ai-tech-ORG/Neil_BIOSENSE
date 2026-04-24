/**
 * performance.js — Zone 2, VO2 max, strength, training load
 */

async function loadPerformance() {
  const [perfData, tlData] = await Promise.all([
    api('/api/performance'),
    api('/api/training-load'),
  ]);
  if (!perfData) return;

  const { workouts, zone2_weekly } = perfData;

  // Zone 2 this week
  const thisWeek = getThisWeekStr();
  const thisWeekData = (zone2_weekly || []).find(w => w.week === thisWeek);
  const zone2Hrs = thisWeekData?.hours || 0;

  const z2El = document.getElementById('p-zone2');
  if (z2El) z2El.textContent = zone2Hrs.toFixed(1);

  const z2Status = document.getElementById('p-zone2-status');
  if (z2Status) {
    if (zone2Hrs >= 4) {
      z2Status.textContent = '✓ Optimal — keep it up';
      z2Status.className = 'metric-trend trend-up';
    } else if (zone2Hrs >= 3) {
      z2Status.textContent = '→ At minimum — push toward 4hrs';
      z2Status.className = 'metric-trend trend-stable';
    } else {
      z2Status.textContent = `↑ ${(3 - zone2Hrs).toFixed(1)}hrs to reach minimum`;
      z2Status.className = 'metric-trend trend-down';
    }
  }

  // Workouts this week
  const weekWorkouts = (workouts || []).filter(w => {
    const wDate = new Date(w.date);
    const weekStart = getWeekStartDate();
    return wDate >= weekStart;
  });

  const wkEl = document.getElementById('p-workouts');
  if (wkEl) animateNumber(wkEl, weekWorkouts.length);

  // VO2 max
  const latestVo2 = await getLatestVO2();
  if (latestVo2) {
    const vo2El = document.getElementById('p-vo2');
    if (vo2El) vo2El.textContent = latestVo2.toFixed(1);

    const marker = document.getElementById('vo2-marker');
    if (marker) {
      const pct = Math.min(Math.max(((latestVo2 - 35) / (70 - 35)) * 100, 0), 95);
      setTimeout(() => { marker.style.left = pct + '%'; }, 300);
    }
  }

  // Training load CTL/ATL/TSB
  if (tlData) {
    renderTrainingLoad(tlData);
  }

  // Training load this week (volume)
  const totalMinThisWeek = weekWorkouts.reduce((a, w) => a + (w.duration_minutes || 0), 0);
  const loadEl = document.getElementById('p-load');
  if (loadEl) loadEl.textContent = Math.round(totalMinThisWeek);

  renderZone2Chart(zone2_weekly || []);
  renderRecentWorkouts(workouts || []);
}

function renderTrainingLoad(tl) {
  // Update CTL/ATL/TSB display
  const ctlEl = document.getElementById('tl-ctl');
  const atlEl = document.getElementById('tl-atl');
  const tsbEl = document.getElementById('tl-tsb');
  const tsbStatus = document.getElementById('tl-status');

  if (ctlEl) animateNumber(ctlEl, tl.ctl);
  if (atlEl) animateNumber(atlEl, tl.atl);
  if (tsbEl) {
    tsbEl.textContent = (tl.tsb > 0 ? '+' : '') + tl.tsb;
    const tsbColor = tl.tsb >= 10 ? '#00e5ff' : tl.tsb >= 0 ? '#00d4aa' : tl.tsb >= -15 ? '#ffaa00' : '#ff2244';
    tsbEl.style.color = tsbColor;
  }
  if (tsbStatus) {
    tsbStatus.textContent = tl.status;
    const statusColor = tl.tsb >= 10 ? '#00e5ff' : tl.tsb >= 0 ? '#00d4aa' : tl.tsb >= -15 ? '#ffaa00' : '#ff2244';
    tsbStatus.style.color = statusColor;
  }

  // Render CTL/ATL chart
  renderTrainingLoadChart(tl.timeline || []);
}

async function getLatestVO2() {
  const data = await api('/api/vitals?days=90');
  if (!data?.vitals) return null;
  const withVO2 = data.vitals.filter(v => v.vo2max).reverse();
  return withVO2[0]?.vo2max || null;
}

function getThisWeekStr() {
  // Match SQLite strftime('%Y-%W') — Monday-based week, 00 before first Monday
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const daysFromMon = (day === 0) ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMon);
  monday.setHours(0,0,0,0);

  const year = monday.getFullYear();
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay();
  const daysToFirstMon = (jan1Day === 0) ? 1 : (jan1Day === 1) ? 0 : (8 - jan1Day);
  const firstMonday = new Date(year, 0, 1 + daysToFirstMon);

  if (monday < firstMonday) return `${year}-00`;
  const weekNum = Math.floor((monday - firstMonday) / (7 * 86400000)) + 1;
  return `${year}-${String(weekNum).padStart(2, '0')}`;
}

function getWeekStartDate() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff));
}

function renderRecentWorkouts(workouts) {
  const container = document.getElementById('recent-workouts');
  if (!container) return;

  const recent = workouts.slice(0, 10);
  if (recent.length === 0) return;

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Duration</th>
          <th>Avg HR</th>
        </tr>
      </thead>
      <tbody>
        ${recent.map(w => `
          <tr>
            <td class="text-dim text-mono">${w.date}</td>
            <td>${workoutIcon(w.type)} ${w.type}</td>
            <td class="mono">${Math.round(w.duration_minutes || 0)}min</td>
            <td class="mono">${w.avg_hr ? Math.round(w.avg_hr) + ' bpm' : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function workoutIcon(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('zone 2') || t.includes('zone2') || t.includes('cycling') || t.includes('bike')) return '🚴';
  if (t.includes('strength') || t.includes('weight') || t.includes('lift')) return '🏋️';
  if (t.includes('run')) return '🏃';
  if (t.includes('swim')) return '🏊';
  if (t.includes('yoga') || t.includes('mobility') || t.includes('recovery')) return '🧘';
  return '⚡';
}

async function logWorkout() {
  const type = document.getElementById('w-type')?.value;
  const duration = parseFloat(document.getElementById('w-duration')?.value) || 0;
  const avg_hr = parseFloat(document.getElementById('w-hr')?.value) || null;
  const notes = document.getElementById('w-notes')?.value;

  if (!type || !duration) {
    alert('Please fill in workout type and duration');
    return;
  }

  await api('/api/workouts', {
    method: 'POST',
    body: JSON.stringify({
      type, duration_minutes: duration, avg_hr, notes,
      date: new Date().toISOString().slice(0, 10),
    }),
  });

  // Clear form
  document.getElementById('w-duration').value = '';
  document.getElementById('w-hr').value = '';
  document.getElementById('w-notes').value = '';

  loadPerformance();
}

async function logExposure() {
  const type = document.getElementById('exposure-type')?.value;
  const duration = document.getElementById('exposure-duration')?.value;
  const temp = document.getElementById('exposure-temp')?.value;
  const notes = `${type} · ${temp ? temp + '°C' : ''} · ${duration}min`;

  await api('/api/workouts', {
    method: 'POST',
    body: JSON.stringify({
      type: type,
      duration_minutes: parseFloat(duration) || 0,
      notes,
      date: new Date().toISOString().slice(0, 10),
    }),
  });

  alert(`${type} logged!`);
}

function renderTrainingLoadChart(timeline) {
  destroyChart('tl-chart');
  const canvas = document.getElementById('tl-chart');
  if (!canvas || !timeline.length) return;

  const labels = timeline.map(d => d.date ? d.date.slice(5) : '');
  const ctlData = timeline.map(d => d.ctl);
  const atlData = timeline.map(d => d.atl);
  const tsbData = timeline.map(d => d.tsb);

  chartInstances['tl-chart'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Fitness (CTL)',
          data: ctlData,
          borderColor: '#00e5ff',
          borderWidth: 2,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
        },
        {
          label: 'Fatigue (ATL)',
          data: atlData,
          borderColor: '#ff2244',
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          borderDash: [3, 4],
        },
        {
          label: 'Form (TSB)',
          data: tsbData,
          borderColor: '#ffaa00',
          borderWidth: 1.5,
          fill: true,
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 120);
            g.addColorStop(0, 'rgba(255,170,0,0.15)');
            g.addColorStop(1, 'rgba(255,170,0,0)');
            return g;
          },
          tension: 0.4,
          pointRadius: 0,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, title: { display: true, text: 'TSS load', color: '#2a5a7a', font: { size: 9, family: 'Share Tech Mono' } } },
        y1: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#ffaa00', font: { family: 'Share Tech Mono', size: 9 } },
          title: { display: true, text: 'Form (TSB)', color: '#ffaa00', font: { size: 9, family: 'Share Tech Mono' } },
        },
      },
      plugins: {
        ...CHART_DEFAULTS.plugins,
        legend: {
          display: true,
          labels: { color: '#4a7a9b', font: { family: 'Share Tech Mono', size: 9 }, boxWidth: 12 },
        },
      },
    },
  });
}

window.loadPerformance = loadPerformance;
window.logWorkout = logWorkout;
window.logExposure = logExposure;
