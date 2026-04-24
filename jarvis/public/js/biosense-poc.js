/**
 * BioSense POC: client-only demo data + views + mock agent
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'biosense_poc_profile_v1';

  const DEFAULT_PROFILE = {
    allergies: 'Fish (anaphylaxis). Shellfish mild intolerance.',
    exercise: 'Strength 4x/week, Zone 2 cycling ~3h/week. Training for Olympic tri in 18 months.',
    familyHistory: 'Father: Type 2 diabetes at 58. Mother: hypothyroid.',
    objectives: 'Lower ApoB, improve VO2 trajectory, fix sleep consistency.',
    firstName: 'Alex',
  };

  const DRAWS = [
    { id: 'd1', label: '12 Jan 2026', short: 'Jan' },
    { id: 'd2', label: '8 Mar 2026', short: 'Mar' },
  ];

  const BIOMARKERS = [
    { key: 'apob', name: 'ApoB', unit: 'mg/dL', refMax: 130, optimalMax: 75, d1: 96, d2: 82 },
    { key: 'ldl', name: 'LDL-C', unit: 'mg/dL', refMax: 100, optimalMax: 70, d1: 118, d2: 98 },
    { key: 'hba1c', name: 'HbA1c', unit: '%', refMax: 5.7, optimalMax: 5.2, d1: 5.5, d2: 5.3 },
    { key: 'fasting_glucose', name: 'Fasting glucose', unit: 'mg/dL', refMax: 99, optimalMax: 85, d1: 94, d2: 88 },
    { key: 'hs_crp', name: 'hs-CRP', unit: 'mg/L', refMax: 3, optimalMax: 1, d1: 1.8, d2: 0.9 },
    { key: 'ferritin', name: 'Ferritin', unit: 'ng/mL', refMin: 30, refMax: 400, optimalMin: 70, optimalMax: 150, d1: 45, d2: 88 },
    { key: 'vitamin_d', name: 'Vitamin D', unit: 'ng/mL', refMin: 30, optimalMin: 40, optimalMax: 60, d1: 28, d2: 44 },
    { key: 'tsh', name: 'TSH', unit: 'mIU/L', refMax: 4.5, optimalMax: 2.5, d1: 2.1, d2: 1.9 },
  ];

  function statusFor(m, val) {
    if (m.optimalMax != null && val > m.optimalMax) return m.refMax != null && val <= m.refMax ? 'warn' : 'bad';
    if (m.optimalMin != null && val < m.optimalMin) return 'warn';
    if (m.optimalMax != null && val <= m.optimalMax) return 'ok';
    if (m.refMax != null && val > m.refMax) return 'bad';
    return 'ok';
  }

  function escapeHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function getProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_PROFILE };
      return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_PROFILE };
    }
  }

  function saveProfile(p) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  }

  let route = 'dashboard';

  function setRoute(r) {
    route = r;
    if (history.replaceState) {
      history.replaceState(null, '', '#' + r);
    } else {
      location.hash = r;
    }
    render();
  }

  function navHtml() {
    const items = [
      ['dashboard', 'Dashboard', '◆'],
      ['profile', 'Profile & objectives', '◎'],
      ['biomarkers', 'Biomarkers', '◇'],
      ['compare', 'Compare draws', '↔'],
      ['reports', 'Reports', '▤'],
      ['journey', 'How am I doing?', '↑'],
      ['agent', 'BioSense Agent', '◉'],
      ['subscription', 'Subscription', '★'],
      ['ops', 'Sample quality', '!'],
    ];
    return items
      .map(
        ([id, label, icon]) =>
          `<a href="#${id}" class="${route === id ? 'active' : ''}" data-route="${id}"><span>${icon}</span> ${label}</a>`
      )
      .join('');
  }

  function layout(inner) {
    const p = getProfile();
    return `
      <div class="bs-layout">
        <aside class="bs-sidebar">
          <div class="bs-brand">BioSense</div>
          <div class="bs-brand-sub">Proof of concept · Demo</div>
          <nav class="bs-nav">${navHtml()}</nav>
        </aside>
        <main class="bs-main">${inner}</main>
      </div>
    `;
  }

  function renderDashboard() {
    const p = getProfile();
    const attention = BIOMARKERS.filter((m) => statusFor(m, m.d2) !== 'ok').length;
    return layout(`
      <h1 class="bs-page-title">Welcome back, ${escapeHtml(p.firstName)}</h1>
      <p class="bs-page-desc">Your dashboard: upcoming testing, biological age, markers that need attention, and quick links to reports.</p>

      <div class="bs-grid bs-grid-3" style="margin-bottom:1rem;">
        <div class="bs-card">
          <h3>Next home blood sample</h3>
          <div class="bs-stat-big" style="font-size:1.35rem;color:var(--bs-text);">28 Apr 2026</div>
          <div class="bs-stat-label">Kit ships 3 days prior · Fasting from 10pm</div>
          <div style="margin-top:0.75rem;">
            <button type="button" class="btn btn-ghost" id="btn-cal">Add reminder</button>
          </div>
        </div>
        <div class="bs-card">
          <h3>Biological age</h3>
          <div class="bs-stat-big">28.4</div>
          <div class="bs-stat-label">vs chronological 34 · <span style="color:var(--bs-green);">−5.6 yrs</span> vs last quarter</div>
        </div>
        <div class="bs-card">
          <h3>Biomarkers</h3>
          <div class="bs-stat-big">${attention}</div>
          <div class="bs-stat-label">need attention (latest draw)</div>
          <div style="margin-top:0.75rem;"><button type="button" class="btn btn-primary" data-go="biomarkers">View all</button></div>
        </div>
      </div>

      <div class="bs-grid bs-grid-2" style="margin-bottom:1rem;">
        <div class="bs-card">
          <h3>Latest smart report</h3>
          <p style="margin:0 0 0.5rem;color:#a8b8c8;font-size:0.92rem;">
            <strong style="color:var(--bs-text);">Easiest wins for you</strong> cross-references your March panel with your objectives (ApoB, sleep consistency, ferritin). Cardio is already in your plan, so LDL-related markers are flagged as high leverage.
          </p>
          <button type="button" class="btn btn-ghost" data-go="reports">Open reports</button>
        </div>
        <div class="bs-card">
          <h3>Ops · sample screening</h3>
          <p style="margin:0;font-size:0.9rem;color:#a8b8c8;">All panels passed automated sanity checks. No flags.</p>
          <button type="button" class="btn btn-ghost" style="margin-top:0.65rem;" data-go="ops">View detail</button>
        </div>
      </div>

      <div class="bs-card">
        <h3>How am I doing? (snapshot)</h3>
        <p style="margin:0 0 0.75rem;color:#a8b8c8;">Since joining BioSense 8 months ago: 5 biomarkers moved into optimal range; estimated trajectory positive on cardiovascular and metabolic pillars.</p>
        <button type="button" class="btn btn-primary" data-go="journey">Full journey</button>
        <button type="button" class="btn btn-ghost" data-go="subscription" style="margin-left:0.5rem;">Upgrade testing</button>
      </div>

      <p class="disclaimer">Demonstration only. Not medical advice. Biological age and statistics are illustrative for the POC.</p>
    `);
  }

  function renderProfile() {
    const p = getProfile();
    return layout(`
      <h1 class="bs-page-title">Profile & objectives</h1>
      <p class="bs-page-desc">Everything the model uses to keep recommendations safe and relevant. Edit any time.</p>

      <div class="bs-card" style="margin-bottom:1rem;">
        <div class="profile-section">
          <label>Preferred name</label>
          <input type="text" id="pf-firstName" value="${escapeHtml(p.firstName)}" />
        </div>
        <div class="profile-section">
          <label>Allergies & intolerances</label>
          <textarea id="pf-allergies">${escapeHtml(p.allergies)}</textarea>
        </div>
        <div class="profile-section">
          <label>Exercise & training</label>
          <textarea id="pf-exercise">${escapeHtml(p.exercise)}</textarea>
        </div>
        <div class="profile-section">
          <label>Family history</label>
          <textarea id="pf-familyHistory">${escapeHtml(p.familyHistory)}</textarea>
        </div>
        <div class="profile-section">
          <label>Objectives</label>
          <textarea id="pf-objectives">${escapeHtml(p.objectives)}</textarea>
        </div>
        <button type="button" class="btn btn-primary" id="pf-save">Save profile</button>
        <span id="pf-saved" style="margin-left:0.75rem;color:var(--bs-green);font-size:0.88rem;opacity:0;">Saved</span>
      </div>
      <p class="disclaimer">Demo persists in this browser only (localStorage).</p>
    `);
  }

  function renderBiomarkers() {
    const rows = BIOMARKERS.map((m) => {
      const st = statusFor(m, m.d2);
      const badge =
        st === 'ok' ? '<span class="badge badge-ok">Optimal</span>' : st === 'warn' ? '<span class="badge badge-warn">In range</span>' : '<span class="badge badge-bad">Review</span>';
      const opt =
        m.optimalMax != null
          ? `≤ ${m.optimalMax} ${m.unit}`
          : m.optimalMin != null
            ? `${m.optimalMin} to ${m.optimalMax ?? 'n/a'} ${m.unit}`
            : 'n/a';
      return `<tr>
        <td><strong>${escapeHtml(m.name)}</strong></td>
        <td>${m.d2} ${m.unit}</td>
        <td>${badge}</td>
        <td style="color:var(--bs-muted);font-size:0.85rem;">${opt}</td>
      </tr>`;
    }).join('');
    return layout(`
      <h1 class="bs-page-title">Biomarkers</h1>
      <p class="bs-page-desc">Latest draw (${DRAWS[1].label}). AI summaries on the Reports tab.</p>
      <div class="bs-card" style="padding:0;overflow:hidden;">
        <table class="bs-table">
          <thead><tr><th>Marker</th><th>Your value</th><th>Status</th><th>Optimal target</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="disclaimer">Reference ranges are simplified for demo.</p>
    `);
  }

  function renderCompare() {
    const rows = BIOMARKERS.map((m) => {
      const delta = m.d2 - m.d1;
      const arrow = delta < 0 ? '↓' : delta > 0 ? '↑' : '→';
      const good =
        (m.key === 'apob' || m.key === 'ldl' || m.key === 'hba1c' || m.key === 'fasting_glucose' || m.key === 'hs_crp') ? delta < 0 : delta > 0;
      const note = good ? '<span style="color:var(--bs-green);">favourable</span>' : '<span style="color:var(--bs-amber);">watch</span>';
      return `<tr>
        <td><strong>${escapeHtml(m.name)}</strong></td>
        <td>${m.d1}</td>
        <td>${m.d2}</td>
        <td>${arrow} ${Math.abs(delta)}</td>
        <td>${note}</td>
      </tr>`;
    }).join('');
    return layout(`
      <h1 class="bs-page-title">Compare draws</h1>
      <p class="bs-page-desc">${DRAWS[0].label} vs ${DRAWS[1].label}. Direction matters by marker (lipids vs ferritin, etc.).</p>
      <div class="bs-card" style="padding:0;overflow:hidden;">
        <table class="bs-table">
          <thead><tr><th>Marker</th><th>${DRAWS[0].short}</th><th>${DRAWS[1].short}</th><th>Delta</th><th>Trend</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="bs-card" style="margin-top:1rem;">
        <h3>AI narrative (demo)</h3>
        <p style="margin:0;color:#a8b8c8;font-size:0.92rem;">
          ApoB and LDL moved down while ferritin and vitamin D improved toward target. Inflammatory marker (hs-CRP) halved. Aligns with your stated objectives and training load. Next review after April draw.
        </p>
      </div>
    `);
  }

  let reportTab = 'smart';

  function renderReports() {
    const smart = `
      <div class="bs-grid bs-grid-2">
        <div class="bs-card">
          <h3>Easiest biomarkers for you</h3>
          <p style="color:#a8b8c8;font-size:0.92rem;margin:0;">Uses your <strong>profile</strong> + latest panel: fish allergy respected (no omega-3 from fish); triathlon goal weights cardio-friendly markers. Top picks: ApoB trajectory, vitamin D, sleep-adjacent glucose stability.</p>
        </div>
        <div class="bs-card">
          <h3>Cardio-linked opportunities</h3>
          <p style="color:#a8b8c8;font-size:0.92rem;margin:0;">You already train Zone 2. LDL and ApoB still have headroom; smart report suggests timing tests after a deload week for cleaner interpretation.</p>
        </div>
      </div>
      <p style="margin-top:1rem;">
        <button type="button" class="btn btn-ghost" id="btn-email-pdf">Email PDF summary (demo)</button>
      </p>`;
    const custom = `
      <div class="bs-card">
        <h3>Custom reports</h3>
        <p style="color:#a8b8c8;margin:0 0 1rem;">Ask the BioSense Agent: e.g. “Top 5 markers I can fix first with a 4-week plan.” The agent can generate a structured PDF-style summary (demo shows copy only).</p>
        <button type="button" class="btn btn-primary" data-go="agent">Open agent</button>
      </div>`;
    const body = reportTab === 'smart' ? smart : custom;
    return layout(`
      <h1 class="bs-page-title">Reports</h1>
      <p class="bs-page-desc">Smart reports are generated automatically. Custom reports start from conversation.</p>
      <div class="report-tabs">
        <button type="button" class="${reportTab === 'smart' ? 'active' : ''}" data-tab="smart">Smart reports</button>
        <button type="button" class="${reportTab === 'custom' ? 'active' : ''}" data-tab="custom">Custom reports</button>
      </div>
      ${body}
    `);
  }

  function renderJourney() {
    return layout(`
      <h1 class="bs-page-title">How am I doing?</h1>
      <p class="bs-page-desc">Journey since you started with BioSense (demo metrics).</p>

      <div class="bs-grid bs-grid-3" style="margin-bottom:1.5rem;">
        <div class="bs-card"><h3>Months on programme</h3><div class="bs-stat-big">8</div></div>
        <div class="bs-card"><h3>Biomarkers to optimal</h3><div class="bs-stat-big">5</div></div>
        <div class="bs-card"><h3>Bio age vs start</h3><div class="bs-stat-big" style="color:var(--bs-green);">−2.1 yr</div><div class="bs-stat-label">illustrative</div></div>
      </div>

      <div class="bs-card" style="margin-bottom:1rem;">
        <h3>Motivation layer (demo)</h3>
        <p style="color:#a8b8c8;margin:0;">Based on your trajectory and population-style modelling (not shown in POC), copy might read: “You’ve moved key cardiovascular inputs in a direction associated with lower long-term risk.” Marketing and medical teams would agree exact wording.</p>
      </div>

      <div class="bs-card">
        <h3>Timeline</h3>
        <div class="timeline-item"><strong>Jun 2025</strong> · Onboarding, first panel</div>
        <div class="timeline-item"><strong>Jan 2026</strong> · Second draw, ApoB focus</div>
        <div class="timeline-item" style="border-left-color:transparent;padding-bottom:0;"><strong>Mar 2026</strong> · Latest panel, ferritin + D improved</div>
      </div>
      <p class="disclaimer">Statistics are placeholders for investor demo. Real product needs validated methodology.</p>
    `);
  }

  const CHAT_KEY = 'biosense_poc_chat_v1';

  function getChatHistory() {
    try {
      const j = localStorage.getItem(CHAT_KEY);
      if (!j) return [{ role: 'agent', text: "I'm your BioSense Agent. Ask about your results, request a custom report, or say 'take me to reports' to navigate." }];
      return JSON.parse(j);
    } catch {
      return [{ role: 'agent', text: "I'm your BioSense Agent. Try: show my status, open reports, or book help." }];
    }
  }

  function saveChatHistory(h) {
    localStorage.setItem(CHAT_KEY, JSON.stringify(h.slice(-30)));
  }

  function agentReply(userText) {
    const t = userText.toLowerCase();
    const p = getProfile();
    if (/report/.test(t) && /open|show|take|see|go/.test(t)) {
      setTimeout(() => setRoute('reports'), 400);
      return "Opening Reports now. You'll see Smart vs Custom tabs.";
    }
    if (/profile|objectives|allerg/.test(t)) {
      setTimeout(() => setRoute('profile'), 400);
      const allergyPreview = (p.allergies || '').split('.')[0] || 'on file';
      return `Opening your profile. I have your allergies on file (e.g. ${allergyPreview}).`;
    }
    if (/biomarker|panel|lab/.test(t)) {
      setTimeout(() => setRoute('biomarkers'), 400);
      return 'Here are your biomarkers. Latest draw is March. ApoB and LDL are still the main focus vs your goals.';
    }
    if (/subscribe|upgrade|plan|pricing|2 test|two test/.test(t)) {
      setTimeout(() => setRoute('subscription'), 400);
      return 'Showing subscription options. Twice-yearly testing makes trends much clearer for athletes.';
    }
    if (/compare|two draw|previous|january|march/.test(t)) {
      setTimeout(() => setRoute('compare'), 400);
      return 'Pulling up January vs March. Biggest wins: ApoB, hs-CRP, vitamin D.';
    }
    if (/easiest|top five|5 biomarker|fix first|roadmap/.test(t)) {
      return `Custom report (demo): Your fastest wins are ApoB (nutrition + timing with training), vitamin D (supplement, non-fish if needed), and sleep consistency for glucose. I’ve avoided fish-based suggestions given your allergy. Full PDF export would ship in production.`;
    }
    if (/book|blood|sample|when|test/.test(t)) {
      return 'Next home draw: 28 Apr 2026. You’ll get a kit 3 days before. Fasting from 10pm the night before.';
    }
    if (/hello|hi |hey /.test(t)) {
      return `Hey ${p.firstName}. Your latest panel shows solid progress on inflammation and vitamin D. Want the compare view or a custom roadmap?`;
    }
    return `I can navigate to Reports, Profile, Biomarkers, Compare draws, or Subscription. Try: “Take me to reports” or “Top 5 easiest markers to fix.”`;
  }

  function renderAgent() {
    const hist = getChatHistory();
    const bubbles = hist
      .map(
        (m) =>
          `<div class="chat-bubble ${m.role}">${escapeHtml(m.text)}</div>`
      )
      .join('');
    return layout(`
      <h1 class="bs-page-title">BioSense Agent</h1>
      <p class="bs-page-desc">Demo agent: rule-based answers + navigation. Production would use your stack and tools.</p>
      <div class="quick-actions">
        <button type="button" data-q="Take me to reports">Take me to reports</button>
        <button type="button" data-q="Show my biomarkers">Show biomarkers</button>
        <button type="button" data-q="Compare January and March draws">Compare draws</button>
        <button type="button" data-q="Top 5 easiest biomarkers to fix with a plan">Custom report ask</button>
        <button type="button" data-q="Upgrade to 2 tests per year">Upsell ask</button>
      </div>
      <div class="chat-wrap">
        <div class="chat-log" id="chat-log">${bubbles}</div>
        <div class="chat-input-row">
          <input type="text" id="chat-input" placeholder="Message BioSense Agent…" autocomplete="off" />
          <button type="button" class="btn btn-primary" id="chat-send">Send</button>
        </div>
      </div>
      <p style="margin-top:0.75rem;"><button type="button" class="btn btn-ghost" id="chat-clear">Clear chat history</button></p>
    `);
  }

  function renderSubscription() {
    return layout(`
      <h1 class="bs-page-title">Subscription</h1>
      <p class="bs-page-desc">Illustrative plans for the POC. Upsell nudges in production depend on engagement rules you define.</p>
      <div class="bs-grid bs-grid-2">
        <div class="plan-card">
          <h3>Essential</h3>
          <div class="plan-price">£X / mo</div>
          <p style="color:#a8b8c8;font-size:0.9rem;">1 comprehensive panel per year · Dashboard · Smart reports</p>
          <button type="button" class="btn btn-ghost" style="margin-top:1rem;">Current (demo)</button>
        </div>
        <div class="plan-card featured">
          <h3>Performance</h3>
          <div class="plan-price">£Y / mo</div>
          <p style="color:#a8b8c8;font-size:0.9rem;">2 panels per year · Sharper trends · Priority agent · Custom report credits</p>
          <p style="font-size:0.8rem;color:var(--bs-teal);margin:0.5rem 0 0;">Suggested: your markers track cleaner with semi-annual testing.</p>
          <button type="button" class="btn btn-primary" style="margin-top:1rem;">Upgrade (demo)</button>
        </div>
      </div>
    `);
  }

  function renderOps() {
    return layout(`
      <h1 class="bs-page-title">Sample quality</h1>
      <p class="bs-page-desc">Operational screening: haemolysis risk, impossible combinations, duplicate entries. Demo shows clear state.</p>
      <div class="alert-ops" style="border-color:rgba(74,222,128,0.35);background:rgba(74,222,128,0.06);">
        <strong style="color:var(--bs-green);">All clear</strong><br />
        Latest March draw passed QC checks. No management alert required.
      </div>
      <div class="bs-card" style="margin-top:1rem;">
        <h3>What production would flag (examples)</h3>
        <ul style="margin:0;padding-left:1.2rem;color:#a8b8c8;">
          <li>Biologically inconsistent panels (e.g. extreme conflict between related markers)</li>
          <li>Probable lab entry error or mislabelled tube</li>
          <li>Triggers an ops workflow, not an automatic user message</li>
        </ul>
      </div>
    `);
  }

  function render() {
    const root = document.getElementById('biosense-root');
    if (!root) return;

    const map = {
      dashboard: renderDashboard,
      profile: renderProfile,
      biomarkers: renderBiomarkers,
      compare: renderCompare,
      reports: renderReports,
      journey: renderJourney,
      agent: renderAgent,
      subscription: renderSubscription,
      ops: renderOps,
    };

    const fn = map[route] || map.dashboard;
    root.innerHTML = fn();
    bind();
    if (route === 'agent') {
      const log = document.getElementById('chat-log');
      if (log) log.scrollTop = log.scrollHeight;
    }
  }

  function bind() {
    document.querySelectorAll('[data-route]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        setRoute(a.getAttribute('data-route'));
      });
    });
    document.querySelectorAll('[data-go]').forEach((b) => {
      b.addEventListener('click', () => setRoute(b.getAttribute('data-go')));
    });
    document.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => {
        reportTab = b.getAttribute('data-tab');
        render();
      });
    });

    const btnCal = document.getElementById('btn-cal');
    if (btnCal) btnCal.addEventListener('click', () => alert('Demo: calendar invite would download or open ICS.'));

    const save = document.getElementById('pf-save');
    if (save) {
      save.addEventListener('click', () => {
        const p = {
          firstName: document.getElementById('pf-firstName').value.trim() || 'Alex',
          allergies: document.getElementById('pf-allergies').value,
          exercise: document.getElementById('pf-exercise').value,
          familyHistory: document.getElementById('pf-familyHistory').value,
          objectives: document.getElementById('pf-objectives').value,
        };
        saveProfile(p);
        const el = document.getElementById('pf-saved');
        if (el) {
          el.style.opacity = '1';
          setTimeout(() => {
            el.style.opacity = '0';
          }, 2000);
        }
      });
    }

    const send = document.getElementById('chat-send');
    const input = document.getElementById('chat-input');
    const clear = document.getElementById('chat-clear');
    const emailPdf = document.getElementById('btn-email-pdf');
    if (emailPdf) {
      emailPdf.addEventListener('click', () =>
        alert('Demo: an actionable PDF would be generated and sent to your email.')
      );
    }

    function pushChat(userText) {
      const h = getChatHistory();
      h.push({ role: 'user', text: userText });
      const reply = agentReply(userText);
      h.push({ role: 'agent', text: reply });
      saveChatHistory(h);
      render();
    }

    if (send && input) {
      const go = () => {
        const t = input.value.trim();
        if (!t) return;
        input.value = '';
        pushChat(t);
      };
      send.addEventListener('click', go);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
    }

    document.querySelectorAll('.quick-actions [data-q]').forEach((b) => {
      b.addEventListener('click', () => {
        pushChat(b.getAttribute('data-q'));
      });
    });

    if (clear) {
      clear.addEventListener('click', () => {
        localStorage.removeItem(CHAT_KEY);
        render();
      });
    }
  }

  function initRoute() {
    const h = (location.hash || '').replace(/^#/, '');
    if (h && /^(dashboard|profile|biomarkers|compare|reports|journey|agent|subscription|ops)$/.test(h)) {
      route = h;
    } else route = 'dashboard';
  }

  window.addEventListener('hashchange', () => {
    initRoute();
    render();
  });

  initRoute();
  render();
})();
