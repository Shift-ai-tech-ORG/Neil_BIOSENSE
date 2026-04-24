/**
 * longevity.js — Longevity OS dashboard
 * Renders biomarker targets, protocols, timeline, and priority actions
 */

async function loadLongevity() {
  const data = await api('/api/longevity');
  if (!data) return;

  renderLongevityScore(data);
  renderPriorityActions(data);
  renderBiomarkerBars(data);
  renderThisWeek(data);
  renderSupplementUpdates(data);
  renderExerciseTargets(data);
  renderTimeline(data);
  renderAllProtocols(data);
}

function renderLongevityScore(data) {
  const { bioAge, longevityScore, keyMetrics } = data;

  // Biological age
  const bioAgeEl = document.getElementById('lng-bio-age');
  const bioAgeNote = document.getElementById('lng-bio-age-note');
  if (bioAgeEl && bioAge !== null) {
    bioAgeEl.textContent = bioAge;
    const diff = 25 - bioAge;
    if (bioAgeNote) {
      bioAgeNote.textContent = diff > 0
        ? `▲ ${diff} years younger than chronological`
        : diff < 0 ? `▼ ${Math.abs(diff)} years older than chronological`
        : 'Equal to chronological age';
      bioAgeNote.style.color = diff >= 0 ? 'var(--teal)' : '#ff6b6b';
    }
  }

  // Longevity score
  const scoreEl = document.getElementById('lng-score');
  const scoreNote = document.getElementById('lng-score-note');
  if (scoreEl) {
    scoreEl.textContent = longevityScore;
    scoreEl.style.color = longevityScore >= 80 ? 'var(--teal)' : longevityScore >= 60 ? '#f4c430' : '#ff6b6b';
    if (scoreNote) {
      scoreNote.textContent = longevityScore >= 85 ? 'Elite' : longevityScore >= 70 ? 'Good' : longevityScore >= 50 ? 'Average' : 'Needs work';
    }
  }

  // hs-CRP
  const crpEl = document.getElementById('lng-crp');
  const crpStatus = document.getElementById('lng-crp-status');
  if (crpEl && keyMetrics.crp !== undefined && keyMetrics.crp !== null) {
    crpEl.textContent = keyMetrics.crp.toFixed(2);
    const isOpt = keyMetrics.crp < 1;
    crpEl.style.color = keyMetrics.crp < 0.5 ? 'var(--teal)' : keyMetrics.crp < 1 ? '#00ff88' : '#ff6b6b';
    if (crpStatus) {
      crpStatus.textContent = keyMetrics.crp < 0.5 ? '✓ OPTIMAL — top 10%' : keyMetrics.crp < 1 ? 'Low' : keyMetrics.crp < 3 ? 'Elevated' : '⚠️ High';
      crpStatus.style.color = isOpt ? 'var(--teal)' : '#ff6b6b';
    }
  }

  // HbA1c
  const hba1cEl = document.getElementById('lng-hba1c');
  const hba1cStatus = document.getElementById('lng-hba1c-status');
  if (hba1cEl && keyMetrics.hba1c !== undefined && keyMetrics.hba1c !== null) {
    hba1cEl.textContent = keyMetrics.hba1c;
    const isOpt = keyMetrics.hba1c < 35;
    hba1cEl.style.color = keyMetrics.hba1c < 30 ? 'var(--teal)' : keyMetrics.hba1c < 39 ? '#f4c430' : '#ff6b6b';
    if (hba1cStatus) {
      hba1cStatus.textContent = keyMetrics.hba1c < 30 ? '✓ OPTIMAL' : keyMetrics.hba1c < 39 ? 'Normal' : '⚠️ Prediabetic';
      hba1cStatus.style.color = isOpt ? 'var(--teal)' : '#f4c430';
    }
  }
}

function renderPriorityActions(data) {
  const container = document.getElementById('longevity-priority-actions');
  if (!container) return;

  const { keyMetrics } = data;
  const actions = [];

  // H. pylori
  if (keyMetrics.hpylori === 1) {
    actions.push({
      priority: 1,
      icon: '🦠',
      title: 'H. pylori POSITIVE — Treatment in progress',
      body: 'Complete the full antibiotic course without skipping doses. Take probiotics 2hrs apart from antibiotics. ZERO alcohol. Retest at 8 weeks.',
      colour: '#ff6b6b',
      tag: 'CRITICAL'
    });
  }

  // Omega-3
  if (keyMetrics.omega3 !== null && keyMetrics.omega3 !== undefined && keyMetrics.omega3 < 8) {
    actions.push({
      priority: 2,
      icon: '🐟',
      title: `Omega-3 Index ${keyMetrics.omega3}% → Target >8%`,
      body: 'Current level is sub-optimal. Upgrade from 2 capsules to 3g EPA+DHA/day. Try Nordic Naturals Ultimate Omega or Thorne Omega-3.',
      colour: '#f4c430',
      tag: 'ACTION NOW'
    });
  }

  // eGFR / creatine note
  if (keyMetrics.crp !== null && keyMetrics.crp !== undefined) {
    // If eGFR was borderline, remind them
    actions.push({
      priority: 3,
      icon: '🫘',
      title: 'eGFR 87 — borderline (likely creatine-confounded)',
      body: 'Stop creatine 7 days before your October 2026 blood test. Stay well-hydrated on test day. This is almost certainly not a real kidney issue.',
      colour: '#7b8fff',
      tag: 'NOTE'
    });
  }

  // Glycine upgrade
  actions.push({
    priority: 4,
    icon: '💤',
    title: 'Upgrade Glycine 1.2g → 3g before bed',
    body: 'Clinical sleep studies show 3g glycine before sleep significantly improves deep sleep quality and morning alertness. Your current 1.2g is under-dosed.',
    colour: '#00e5ff',
    tag: 'EASY WIN'
  });

  if (actions.length === 0) {
    container.innerHTML = `<div style="color:var(--teal);padding:12px">✓ No critical actions — maintain current protocols</div>`;
    return;
  }

  container.innerHTML = actions.map(a => `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.06);last-child:border-none">
      <div style="font-size:22px;line-height:1;margin-top:2px">${a.icon}</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <strong style="color:${a.colour};font-size:13px">${a.title}</strong>
          <span style="background:${a.colour}22;color:${a.colour};font-size:10px;padding:2px 7px;border-radius:3px;font-family:'Share Tech Mono',monospace;letter-spacing:0.05em">${a.tag}</span>
        </div>
        <div style="color:var(--text-muted);font-size:12px;line-height:1.5">${a.body}</div>
      </div>
    </div>
  `).join('');
}

function renderBiomarkerBars(data) {
  const container = document.getElementById('longevity-biomarker-bars');
  if (!container) return;

  const { keyMetrics, scoreItems } = data;

  const bars = [
    {
      label: 'hs-CRP (Inflammation)',
      value: keyMetrics.crp,
      min: 0, max: 5,
      target: 1,
      unit: 'mg/L',
      lowerIsBetter: true,
      optimal: 0.5,
      status: keyMetrics.crp < 0.5 ? 'optimal' : keyMetrics.crp < 1 ? 'good' : 'warn'
    },
    {
      label: 'HbA1c (Blood Sugar)',
      value: keyMetrics.hba1c,
      min: 20, max: 60,
      target: 35,
      unit: 'mmol/mol',
      lowerIsBetter: true,
      optimal: 30,
      status: keyMetrics.hba1c < 30 ? 'optimal' : keyMetrics.hba1c < 39 ? 'good' : 'warn'
    },
    {
      label: 'Omega-3 Index',
      value: keyMetrics.omega3,
      min: 0, max: 12,
      target: 8,
      unit: '%',
      lowerIsBetter: false,
      optimal: 8,
      status: keyMetrics.omega3 >= 8 ? 'optimal' : keyMetrics.omega3 >= 6 ? 'good' : 'warn'
    },
    {
      label: 'Vitamin D',
      value: keyMetrics.vitd,
      min: 0, max: 200,
      target: 75,
      unit: 'nmol/L',
      lowerIsBetter: false,
      optimal: 100,
      status: keyMetrics.vitd >= 75 ? 'optimal' : keyMetrics.vitd >= 50 ? 'good' : 'warn'
    },
    {
      label: 'HRV (Autonomic Health)',
      value: keyMetrics.hrv,
      min: 0, max: 100,
      target: 60,
      unit: 'ms',
      lowerIsBetter: false,
      optimal: 80,
      status: keyMetrics.hrv >= 80 ? 'optimal' : keyMetrics.hrv >= 55 ? 'good' : keyMetrics.hrv ? 'warn' : null
    },
    {
      label: 'Testosterone',
      value: keyMetrics.testosterone,
      min: 0, max: 35,
      target: 18,
      unit: 'nmol/L',
      lowerIsBetter: false,
      optimal: 20,
      status: keyMetrics.testosterone >= 18 ? 'optimal' : keyMetrics.testosterone >= 14 ? 'good' : 'warn'
    }
  ].filter(b => b.value !== null && b.value !== undefined);

  const colour = {
    optimal: 'var(--teal)',
    good: '#00ff88',
    warn: '#f4c430',
    bad: '#ff6b6b'
  };

  container.innerHTML = bars.map(b => {
    const pct = Math.min(100, Math.max(0, ((b.value - b.min) / (b.max - b.min)) * 100));
    const targetPct = Math.min(100, ((b.target - b.min) / (b.max - b.min)) * 100);
    const c = colour[b.status] || '#888';
    return `
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-size:12px;color:var(--text-muted)">${b.label}</span>
          <span style="font-size:12px;font-family:'Share Tech Mono',monospace;color:${c}">${b.value} ${b.unit}</span>
        </div>
        <div style="position:relative;height:8px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:visible">
          <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${c};border-radius:4px;transition:width 0.6s"></div>
          <div style="position:absolute;left:${targetPct}%;top:-3px;width:2px;height:14px;background:rgba(255,255,255,0.4);border-radius:1px" title="Target: ${b.target}${b.unit}"></div>
        </div>
        <div style="text-align:right;font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px">Target: ${b.target}${b.unit}</div>
      </div>
    `;
  }).join('');
}

function renderThisWeek(data) {
  const container = document.getElementById('longevity-this-week');
  if (!container) return;

  const weekActions = [
    { done: false, icon: '💊', text: 'Take every dose of H. pylori antibiotics — no exceptions' },
    { done: false, icon: '🐟', text: 'Order high-dose Omega-3 (3g EPA+DHA/day) — Nordic Naturals or Thorne' },
    { done: false, icon: '🧫', text: 'Add probiotic supplement, taken 2hrs away from antibiotics' },
    { done: false, icon: '🍯', text: 'Manuka honey UMF 10+ teaspoon before breakfast each day' },
    { done: false, icon: '🚴', text: '3+ Zone 2 sessions (30-60 min each at 120-140 bpm)' },
    { done: false, icon: '💤', text: 'Buy glycine powder — upgrade to 3g before bed tonight' },
    { done: false, icon: '🚫', text: 'Zero alcohol until H. pylori treatment complete' },
    { done: false, icon: '📅', text: 'Book H. pylori retest for ~8 weeks from treatment start' }
  ];

  container.innerHTML = `
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;font-family:'Share Tech Mono',monospace">WEEK OF ${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'}).toUpperCase()}</div>
    ${weekActions.map(a => `
      <div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
        <div style="font-size:14px;line-height:1.3">${a.icon}</div>
        <div style="font-size:12px;color:var(--text-muted);line-height:1.4">${a.text}</div>
      </div>
    `).join('')}
  `;
}

function renderSupplementUpdates(data) {
  const container = document.getElementById('longevity-supplements');
  if (!container) return;

  const supps = [
    { action: 'UPGRADE', colour: '#ff6b6b', icon: '🐟', name: 'Omega-3', current: '2 caps', target: '3g EPA+DHA/day', note: 'Index at 5% — needs to reach 8%+' },
    { action: 'UPGRADE', colour: '#f4c430', icon: '💤', name: 'Glycine', current: '1.2g', target: '3g before bed', note: 'Improves deep sleep in clinical trials' },
    { action: 'ADD (during treatment)', colour: '#7b8fff', icon: '🧫', name: 'Probiotic', current: 'None', target: 'L. rhamnosus GG or S. boulardii', note: 'Protects gut during antibiotic course' },
    { action: 'KEEP', colour: 'var(--teal)', icon: '☀️', name: 'D3 4000IU', current: '4000IU', target: 'Maintain', note: 'Vitamin D at 77 nmol/L — perfect' },
    { action: 'KEEP', colour: 'var(--teal)', icon: '💪', name: 'Creatine 5g', current: '5g', target: 'Maintain', note: 'Stop 7 days before blood tests' },
    { action: 'KEEP', colour: 'var(--teal)', icon: '🧠', name: 'Lions Mane', current: '2000mg', target: 'Maintain', note: 'Cognitive support — continue' },
    { action: 'KEEP', colour: 'var(--teal)', icon: '🌿', name: 'Curcumin', current: '500mg', target: 'Maintain', note: 'Helping keep CRP at 0.19' },
    { action: 'CONSIDER', colour: '#888', icon: '🌱', name: 'Berberine', current: 'Not taking', target: '500mg with meals', note: 'Long-term metabolic + longevity benefits' }
  ];

  const actionOrder = ['UPGRADE', 'ADD (during treatment)', 'CONSIDER', 'KEEP'];
  const sorted = supps.sort((a, b) => actionOrder.indexOf(a.action) - actionOrder.indexOf(b.action));

  container.innerHTML = sorted.map(s => `
    <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="font-size:16px">${s.icon}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;color:#fff;font-weight:600">${s.name}</span>
          <span style="background:${s.colour}22;color:${s.colour};font-size:9px;padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace">${s.action}</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:1px">${s.note}</div>
      </div>
      <div style="text-align:right;font-size:11px;color:${s.colour};white-space:nowrap">${s.target}</div>
    </div>
  `).join('');
}

function renderExerciseTargets(data) {
  const container = document.getElementById('longevity-exercise');
  if (!container) return;

  const targets = [
    {
      icon: '🚴',
      title: 'Zone 2 Cardio',
      target: '3-4 hrs/week',
      why: '#1 longevity driver — raises VO2max, mitochondrial density',
      colour: 'var(--teal)',
      priority: 'CRITICAL'
    },
    {
      icon: '🏋️',
      title: 'Strength Training',
      target: '3x/week',
      why: 'Prevents sarcopenia — muscle mass predicts longevity independently',
      colour: '#00ff88',
      priority: 'HIGH'
    },
    {
      icon: '⚡',
      title: 'VO2max Intervals',
      target: '1x/week × 4×4 min at 90% HR',
      why: 'Raises VO2max ceiling — strongest all-cause mortality predictor',
      colour: '#f4c430',
      priority: 'MEDIUM'
    },
    {
      icon: '🫁',
      title: 'VO2max Target',
      target: '>50 ml/kg/min',
      why: 'Elite range for 25yo male. Measure via Apple Watch outdoor runs.',
      colour: '#7b8fff',
      priority: 'TRACK'
    },
    {
      icon: '💓',
      title: 'Resting HR Target',
      target: '<50 bpm',
      why: 'Elite aerobic fitness marker — currently tracking in Apple Watch',
      colour: '#888',
      priority: 'TRACK'
    }
  ];

  container.innerHTML = targets.map(t => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="font-size:18px;line-height:1.2">${t.icon}</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
          <span style="font-size:12px;color:#fff;font-weight:600">${t.title}</span>
          <span style="background:${t.colour}22;color:${t.colour};font-size:9px;padding:1px 5px;border-radius:2px;font-family:'Share Tech Mono',monospace">${t.priority}</span>
        </div>
        <div style="font-size:12px;color:var(--teal);font-family:'Share Tech Mono',monospace">${t.target}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:1px">${t.why}</div>
      </div>
    </div>
  `).join('');
}

function renderTimeline(data) {
  const container = document.getElementById('longevity-timeline');
  if (!container) return;

  const { timeline } = data;
  const statusColour = { done: '#888', active: 'var(--teal)', upcoming: '#7b8fff', ongoing: '#f4c430' };
  const statusIcon = { done: '✓', active: '▶', upcoming: '○', ongoing: '∞' };

  container.innerHTML = `
    <div style="position:relative;padding-left:28px">
      <div style="position:absolute;left:10px;top:0;bottom:0;width:1px;background:rgba(0,229,255,0.15)"></div>
      ${timeline.map(e => `
        <div style="position:relative;margin-bottom:16px">
          <div style="position:absolute;left:-22px;top:2px;width:16px;height:16px;border-radius:50%;background:${statusColour[e.status] || '#888'}22;border:1.5px solid ${statusColour[e.status] || '#888'};display:flex;align-items:center;justify-content:center;font-size:8px;color:${statusColour[e.status] || '#888'}">${statusIcon[e.status] || '○'}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
            <span style="font-size:14px">${e.icon}</span>
            <span style="font-size:11px;font-family:'Share Tech Mono',monospace;color:${statusColour[e.status] || '#888'}">${e.date}</span>
          </div>
          <div style="font-size:13px;color:${e.status === 'done' ? '#888' : '#e0e0e0'}">${e.label}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAllProtocols(data) {
  const container = document.getElementById('longevity-all-protocols');
  if (!container) return;

  const { protocols } = data;
  if (!protocols || protocols.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted)">No protocols loaded</div>';
    return;
  }

  const sectionIcons = {
    daily: '📋', retest: '📅', fix_now: '⚠️', maintain: '✅', schedule: '📅',
    targets: '🎯', tracking: '📊', non_negotiable: '🔒', supplements: '💊',
    upgrade_now: '⬆️', keep: '✓', consider: '💡', consider_adding: '💡'
  };

  container.innerHTML = protocols.map(p => {
    const items = JSON.parse(p.items_json || '{}');
    const sections = Object.keys(items);

    return `
      <details style="margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden" ${p.name.includes('H. pylori') ? 'open' : ''}>
        <summary style="padding:12px 16px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;background:rgba(0,229,255,0.04);list-style:none">
          <div>
            <span style="font-size:13px;font-weight:600;color:#e0e0e0">${p.name}</span>
            <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:2px">${p.description}</span>
          </div>
          <span style="color:var(--teal);font-size:12px">▾</span>
        </summary>
        <div style="padding:12px 16px">
          ${sections.map(sec => `
            <div style="margin-bottom:12px">
              <div style="font-size:10px;font-family:'Share Tech Mono',monospace;color:var(--teal);letter-spacing:0.1em;margin-bottom:6px;text-transform:uppercase">${sectionIcons[sec] || '▸'} ${sec.replace(/_/g,' ')}</div>
              ${(items[sec] || []).map(item => `
                <div style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
                  <div style="font-size:14px;line-height:1.4">${item.icon || '•'}</div>
                  <div style="flex:1">
                    <div style="font-size:12px;color:${item.priority === 'critical' || item.priority === 'ACTION NOW' ? '#ff6b6b' : item.priority === 'high' ? '#f4c430' : '#c0c0c0'};line-height:1.4">${item.label}</div>
                    ${item.note ? `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">${item.note}</div>` : ''}
                  </div>
                  ${item.priority ? `<span style="font-size:9px;color:${item.priority === 'critical' || item.priority === 'ACTION NOW' ? '#ff6b6b' : '#888'};font-family:'Share Tech Mono',monospace;white-space:nowrap">${item.priority.toUpperCase()}</span>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </details>
    `;
  }).join('');
}

window.loadLongevity = loadLongevity;
