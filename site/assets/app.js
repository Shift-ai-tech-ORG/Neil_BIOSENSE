/* ===============================================================
   BioSense — Member dashboard (app.js)

   Keeps the entire app in one HTML document. JS responsibilities:
     1. Route via sidebar clicks + #hash (so links inside the page
        can deep-link to e.g. #smart-report).
     2. Handle a small mobile menu drawer.
     3. Canned Sage AI conversation (demo only — every response is a
        pre-written string indexed on keywords; no network.)
   Plain ES, no framework, < 200 LOC.
   =============================================================== */

(function () {
  'use strict';

  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------------------------------------------------------
     1) Section routing
         - Buttons with [data-target] switch the .app-section on
           the main column and mark the matching .app-nav__item
           .is-active.
         - Section IDs mirror sidebar targets: dashboard,
           healthspan, biomarkers, compare, smart-report, sage,
           profile, membership, integrity.
         - We also honour the URL hash so intra-page links
           (e.g. "Ask Sage AI" button jumping to #sage) work.
     --------------------------------------------------------- */

  const sections = $$('.app-section');
  const navItems = $$('.app-nav__item');
  const titleEl  = $('#app-current-title');

  // Declared here (not further down) so activate() → closeSidebar()
  // can reference them on the initial hash-driven load without
  // hitting a Temporal Dead Zone ReferenceError.
  const sidebar = $('.app-sidebar');
  const scrim   = $('.app-sidebar-scrim');
  const toggle  = $('#app-menu-toggle');

  const TITLES = {
    dashboard:    'Dashboard',
    healthspan:   'Healthspan journey',
    biomarkers:   'Biomarkers',
    compare:      'Compare draws',
    'smart-report':'Smart report',
    sage:         'Sage AI',
    profile:      'Profile & goals',
    membership:   'Membership',
    integrity:    'Sample integrity'
  };

  function activate(target) {
    if (!TITLES[target]) target = 'dashboard';

    sections.forEach(s => {
      const match = s.dataset.section === target;
      s.hidden = !match;
      s.classList.toggle('is-active', match);
    });

    navItems.forEach(b => {
      b.classList.toggle('is-active', b.dataset.target === target);
    });

    if (titleEl) titleEl.textContent = TITLES[target];

    // Close mobile drawer on navigate
    closeSidebar();

    // Scroll the main column to top on section change so users
    // don't land mid-scroll after switching.
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    // Keep hash in sync without adding history noise
    if (location.hash.replace('#', '') !== target) {
      history.replaceState(null, '', '#' + target);
    }
  }

  // Sidebar clicks
  navItems.forEach(btn => {
    btn.addEventListener('click', () => activate(btn.dataset.target));
  });

  // Any element inside main content carrying [data-target] also routes
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-target]');
    if (!el) return;
    if (el.classList.contains('app-nav__item')) return; // already handled above
    e.preventDefault();
    activate(el.dataset.target);
  });

  // Deep-link via hash (#smart-report) on load + back/forward
  function fromHash() {
    const h = location.hash.replace('#', '');
    activate(h || 'dashboard');
  }
  window.addEventListener('hashchange', fromHash);
  fromHash();


  /* ---------------------------------------------------------
     2) Mobile menu drawer
         (sidebar/scrim/toggle declared at top of scope)
     --------------------------------------------------------- */
  function openSidebar() {
    if (!sidebar) return;
    sidebar.classList.add('is-open');
    if (scrim) scrim.hidden = false;
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('is-open');
    if (scrim) scrim.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
  }
  if (toggle) toggle.addEventListener('click', () => {
    sidebar.classList.contains('is-open') ? closeSidebar() : openSidebar();
  });
  if (scrim) scrim.addEventListener('click', closeSidebar);


  /* ---------------------------------------------------------
     3) Smart report tabs — purely cosmetic for this demo
     --------------------------------------------------------- */
  $$('.app-tabs').forEach(tabs => {
    const buttons = $$('.app-tab', tabs);
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
      });
    });
  });


  /* ---------------------------------------------------------
     4) Sage AI — canned responses
         The real product grounds every answer in the member's
         panel + profile. For this demo we ship a small keyword
         map + a default. Typing animation is a setTimeout chain
         to keep the interaction feeling alive.
     --------------------------------------------------------- */

  const sageLog   = $('#sage-log');
  const sageForm  = $('#sage-form');
  const sageChips = $('#sage-chips');
  const sageClear = $('#sage-clear');

  const SAGE_INITIAL = "Hello Sarah. I'm Sage — I have your complete panel history, " +
    "objectives, allergy profile, and family history loaded. What would you like to explore today?";

  const SAGE_RESPONSES = [
    { match: /status\s*check|status|april|panel/i, reply:
`Your April panel, CMO-cleared on 2 Apr:

• Biological age 41.2 — 6.8 yrs below calendar age (−1.4 yrs since Oct).
• 9 of 20 markers moved toward longevity-optimal.
• hs-CRP crossed into optimal for the first time (2.4 → 1.1 mg/L).
• HbA1c and fasting glucose both hit longevity threshold.

Two watchpoints: ApoB at 91 mg/dL (target <70 given family history), and
Lp(a) at 53 nmol/L (genetic — CMO reviews annually).` },

    { match: /fastest\s*wins|quick\s*wins|before\s*october|next\s*90/i, reply:
`Before your October draw, these compound: 

1. Zone 2 cardio, 3×/week for 40 min. Biggest single lever on ApoB.
2. Saturated fat <7% of daily kcal — LDL-C and ApoB respond within 6–8 weeks.
3. Continue algae DHA/EPA 2 g/day (safe, non-nut source given your allergy).
4. Sleep 7h floor — directly improves morning cortisol and ApoB trajectory.

Effort: moderate. Expected October delta: ApoB −15 to −20, LDL-C −20 to −30.` },

    { match: /bio(logical)?\s*age|calculation/i, reply:
`Your biological age is a blended estimate across three signals:

• Methylation proxy markers (from blood) — primary weight.
• Glycation + inflammation (HbA1c, hs-CRP, IL-6).
• Organ-system composite (cardiovascular, metabolic, hormonal).

Right now the first two are pulling you younger, the cardiovascular
composite is holding you back. Moving ApoB below 70 would reduce
your biological age by a further ~1.2 years.` },

    { match: /supplement|protocol|stack/i, reply:
`Your 90-day supplement protocol (allergy-filtered — tree-nut sources excluded):

• Vitamin D3 4000 IU · daily · with largest meal.
• Algae DHA/EPA 2 g · daily.
• Methylated B-complex (5-MTHF + methyl-B12) · 8-week block for homocysteine.
• Magnesium glycinate 400 mg · evening · sleep + glucose support.

Skipping recommendations: no nut-derived CoQ10 formulation (allergy),
no probiotic blend containing tree-nut prebiotics. Dr. Mitchell has
cleared this stack against your current levothyroxine dose.` },

    { match: /cardio|cvd|cardiovascular|heart|father/i, reply:
`Your cardiovascular context is the dominant driver of everything we
recommend. Father's event at 55 puts you in a high-vigilance band.

What we watch: ApoB (primary), LDL-C, Lp(a), hs-CRP, fasting insulin.
Your ApoB is now 91 mg/dL — trending well, but longevity-optimal for your
profile is <70. Dr. Mitchell has flagged an October check-in to discuss
whether lifestyle alone is enough or whether a low-dose statin is warranted.

Lp(a) is genetic — diet and exercise don't move it meaningfully. We manage
it by driving every other risk factor to optimal.` },

    { match: /cancer|mother|breast|tumour|tumor/i, reply:
`On cancer context: your mother's breast cancer diagnosis at 62 is in
remission, which means we screen, not predict. Two points for you:

1. Inflammation markers (hs-CRP, IL-6) are now inside or adjacent to
   optimal — lower chronic inflammation is a meaningful lifetime-risk
   lever.
2. Vitamin D is now 52 ng/mL (from 31) — adequate status is associated
   with better outcomes across multiple tumour types.

Dr. Mitchell can arrange referral for imaging screening cadence — ask me
to book that call if you'd like.` },

    { match: /smart\s*report|report/i, reply:
`Three bullets from your April smart report:

• HIGH IMPACT / LOW EFFORT — Vitamin D maintenance, methylated B12+folate
  for homocysteine, 7h sleep floor, algae DHA/EPA.
• HIGH IMPACT / REQUIRES EFFORT — ApoB via sat-fat reduction + Zone 2;
  LDL-C needs a clinician conversation at October review.
• GENETIC / ANNUAL CMO WATCH — Lp(a) 53 nmol/L, manage everything else
  to compensate.` },

    { match: /draw|next\s*draw|october|prep|fast/i, reply:
`October draw prep:

• Kit ships 29 Sep, arrives 30 Sep–1 Oct.
• 12-hour water-only fast before collection (reminder set on your phone).
• Avoid strenuous exercise in the 24h before — inflammation markers spike.
• No supplements the morning of the draw.
• If you've had a cold within 7 days, reschedule — hs-CRP will read noise.

I'll send a 48-hour-out reminder and pre-flight checklist.` }
  ];

  function sageReplyFor(text) {
    const found = SAGE_RESPONSES.find(r => r.match.test(text));
    if (found) return found.reply;
    return "I'd normally ground an answer in your panel data for that. " +
      "In this demo I only respond to a handful of prompts — try the chips above " +
      "or ask about your status, fastest wins, bio age, supplements, cardiovascular " +
      "risk, the smart report, or your next draw prep.";
  }

  function pushMessage(text, who) {
    if (!sageLog) return;
    const el = document.createElement('div');
    el.className = 'app-msg ' + (who === 'user' ? 'app-msg--user' : 'app-msg--ai');
    el.textContent = text;
    sageLog.appendChild(el);
    sageLog.scrollTop = sageLog.scrollHeight;
  }

  function sageSend(text) {
    const v = (text || '').trim();
    if (!v) return;
    pushMessage(v, 'user');
    // Simulated thinking — short, reduced-motion friendly.
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => pushMessage(sageReplyFor(v), 'ai'), reduceMotion ? 0 : 460);
  }

  if (sageForm) {
    sageForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = sageForm.querySelector('input[name="q"]');
      sageSend(input.value);
      input.value = '';
    });
  }

  if (sageChips) {
    sageChips.addEventListener('click', (e) => {
      const chip = e.target.closest('.app-chip');
      if (!chip) return;
      // Route to Sage section first so the chip's effect is visible
      activate('sage');
      sageSend(chip.dataset.prompt || chip.textContent);
    });
  }

  if (sageClear) {
    sageClear.addEventListener('click', () => {
      if (!sageLog) return;
      sageLog.innerHTML = '';
      pushMessage(SAGE_INITIAL, 'ai');
    });
  }

})();
