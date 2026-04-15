/**
 * Solo Play App — single-player mode with AI opponents.
 * No Firebase. All state is local. Reuses game-engine.js and ui-helpers.js.
 */

import {
  buildConfig, createInitialState, initRegimeData, REGIMES, REGIME_LABELS,
  processRound, processPermitTrade, completeRegime, computeDeadweightLoss,
  defaultPermitsPerFirm, maxAllowedProduction, unitsPerPermit,
  permitsRemaining, totalTaxPaidByFirm,
  regimeSequence, nextRegimeAfter, roundProfitDetailForFirm,
} from './game-engine.js';

import {
  fmt, fmtMoney, renderCO2Meter, firmColor,
  regimeUsesCleanTech, regimeUsesTax, regimeUsesPermits, regimeHasCap,
  regimeHasPermitMarket, regimeDescription, debriefPrompt, ppmContext,
  dwlAnalogy, facilitatorNotes,
} from './ui-helpers.js';

import {
  PERSONALITIES, getPersonality,
  aiProductionDecision, aiCleanTechDecisions, aiReservationPrice, aiEvaluateTrade,
} from './ai-strategies.js';

/* ── Constants ── */

const PLAYER_FIRM = 0;
const NUM_FIRMS = 5;
const NUM_ROUNDS = 5;

const CHART_REGIME_COLORS = {
  freemarket: '#0072B2',
  cac: '#D55E00',
  tax: '#009E73',
  trade: '#CC79A7',
  trademarket: '#E69F00',
};

/* ── State ── */

let state = null;
let currentScreen = 'welcome';
let playerProposals = {};
let chartInstances = [];
let cleanTechDecisionMade = {};

const content = document.getElementById('content');

/* ── Educator commentary (shown in debrief between regimes) ── */

function educatorCommentary(regime) {
  const commentary = {
    freemarket: `<p><strong>What typically happens in a classroom:</strong> Students almost always trigger catastrophe by round 3 or 4. Every firm produces at maximum capacity because it is individually rational to do so. When asked "Why did everyone produce so much?", students articulate the profit incentive, then realise it leads to collective failure.</p>
<p><strong>The key pedagogic insight:</strong> This is the tragedy of the commons in action. Rational individual behaviour produces a collectively irrational outcome. Many student groups spontaneously propose some form of production limit at this point — which is precisely what the next regime introduces.</p>`,

    cac: `<p><strong>What typically happens in a classroom:</strong> Catastrophe is usually avoided, but students quickly notice the inflexibility. Every firm is capped at the same level regardless of efficiency. Some students complain about being "stuck" — they have capital to spare but cannot use it.</p>
<p><strong>The key pedagogic insight:</strong> Command and control provides quantity certainty (emissions are controlled) but at the cost of economic efficiency. The deadweight loss shows real value being destroyed. Students often propose allowing firms to differ — "what if more efficient firms could produce more?" — which leads naturally to price-based instruments.</p>`,

    tax: `<p><strong>What typically happens in a classroom:</strong> Clean-tech firms earn noticeably less in rounds 1–2, provoking strong reactions about fairness. By round 3, the compounding tax saving overtakes the setup cost. Students begin to see that different firms face different abatement costs and that transitioning to cleaner production has real upfront costs.</p>
<p><strong>The key pedagogic insight:</strong> A carbon tax gives price certainty but not quantity certainty — total emissions depend on how firms respond to the price signal. The tax rate may be too low (or too high). Students often ask: "What if we just set a hard limit on total emissions instead?" — which is exactly what permits do.</p>`,

    trade: `<p><strong>What typically happens in a classroom:</strong> Some firms finish with unused permits while others are constrained. Students quickly spot the inefficiency: "I have permits I don't need, and you want more — why can't we trade?" This is the single most powerful pedagogic moment in the game.</p>
<p><strong>The key pedagogic insight:</strong> A permit cap controls total emissions with certainty, but without a market mechanism, permits cannot flow to where they are most valued. The spontaneous proposal to allow trading is the intellectual foundation of cap-and-trade systems.</p>`,

    trademarket: `<p><strong>What typically happens in a classroom:</strong> The permit price typically stabilises after 2–3 trades. Clean-tech firms tend to sell permits to standard firms. Total emissions stay within the cap while economic efficiency improves compared to a cap without trade.</p>
<p><strong>The key pedagogic insight:</strong> Cap and trade combines quantity certainty (the hard cap) with economic efficiency (market allocation). However, it is vulnerable to political capture — if firms can lobby to increase the cap or manipulate the market, the environmental guarantee weakens. This connects to real-world debates about the EU ETS, California's programme, and carbon border adjustments.</p>`,
  };
  return commentary[regime] || '';
}

/* ── Initialise game ── */

function startGame() {
  const config = buildConfig({ numFirms: NUM_FIRMS, numRounds: NUM_ROUNDS });
  state = createInitialState(config);
  state.firms[0].name = 'Your Firm';
  state.firms[1].name = 'Firm B';
  state.firms[2].name = 'Firm C';
  state.firms[3].name = 'Firm D';
  state.firms[4].name = 'Firm E';
  state.regime = 'freemarket';
  state.regimeData.freemarket = initRegimeData(config);
  currentScreen = 'regime';
  render();
}

function sessionRegimes() {
  return state ? regimeSequence(state.config) : REGIMES;
}

/* ── Main render ── */

function render() {
  destroyCharts();
  switch (currentScreen) {
    case 'welcome': content.innerHTML = renderWelcome(); break;
    case 'regime': content.innerHTML = renderRegimeScreen(); break;
    case 'debrief': content.innerHTML = renderDebriefScreen(); break;
    case 'results': content.innerHTML = renderResultsScreen(); break;
    default: content.innerHTML = renderWelcome();
  }
  if (currentScreen === 'results') {
    requestAnimationFrame(() => mountResultsCharts());
  }
  renderNav();
}

function renderNav() {
  const nav = document.getElementById('regimeNav');
  if (!nav || !state) { if (nav) nav.innerHTML = ''; return; }
  const seq = sessionRegimes();
  nav.innerHTML = `<div class="regime-nav-row">
    ${seq.map((r, idx) => {
      const active = state.regime === r && currentScreen === 'regime';
      const completed = state.completedRegimes.includes(r);
      const debriefing = state.regime === r && currentScreen === 'debrief';
      const reachable = completed || state.regime === r || (state.completedRegimes.includes(seq[idx - 1]) && seq.indexOf(r) <= seq.indexOf(state.regime));
      return `<button class="regime-btn ${active || debriefing ? 'active' : ''} ${completed ? 'completed' : ''} ${!reachable ? 'locked' : ''}"
                      ${!reachable ? 'disabled' : ''} onclick="window.soloApp.viewRegimeTab('${r}')">${idx + 1}. ${REGIME_LABELS[r]}</button>`;
    }).join('')}
    <button class="regime-btn ${currentScreen === 'results' ? 'active' : ''} ${state.completedRegimes.length < seq.length ? 'locked' : ''}"
            ${state.completedRegimes.length < seq.length ? 'disabled' : ''} onclick="window.soloApp.viewResults()">Results</button>
  </div>`;
}

/* ── Welcome screen ── */

function renderWelcome() {
  return `
    <div class="card solo-welcome">
      <h2>Solo Play Demo</h2>
      <p style="margin-bottom:1rem;">
        Experience the Carbon Pricing Simulation Game as a single player alongside four AI-controlled firms.
        You will play through five regulatory regimes, each with five rounds, to see how different carbon
        pricing approaches affect emissions and profits.
      </p>
      <div class="info-box accent" style="margin-bottom:1rem;">
        <strong>How it works:</strong> You control <strong>Firm A</strong> (Your Firm). Four AI firms make
        their own profit-maximising decisions — some are aggressively short-term, others are more strategic.
        Between regimes, educator commentary explains what typically happens in a classroom session.
      </div>
      <div class="info-box" style="background:#fafbfc;border:1px solid var(--border);margin-bottom:1.25rem;font-size:0.88rem;">
        <strong>Game rules:</strong> Each thingamabob costs $1 to produce, sells for $2, and generates
        CO\u2082 emissions. If total emissions reach the catastrophe threshold, the climate tipping point
        is breached. Each regime introduces a different approach to managing this tension between profit
        and the environment.
      </div>
      <button class="btn btn-primary btn-block" onclick="window.soloApp.startGame()" style="font-size:1.05rem;padding:0.75rem;">
        Start Solo Game
      </button>
    </div>`;
}

/* ── Regime screen (rounds) ── */

function renderRegimeScreen() {
  if (!state) return '';
  const regime = state.regime;
  const d = state.regimeData[regime];
  if (!d) return '';
  const config = state.config;
  const fd = d.firms[PLAYER_FIRM];
  const roundDone = d.currentRound >= config.numRounds;

  let html = '';

  html += `<div class="card">
    <h2>${REGIME_LABELS[regime]}</h2>
    <div class="info-box accent">${regimeDescription(regime, config)}</div>
  </div>`;

  const fnotes = facilitatorNotes(regime);
  if (fnotes) {
    html += `<details class="facilitator-notes">
      <summary>Educator Notes — ${REGIME_LABELS[regime]}</summary>
      <div class="fn-body">
        <p><strong>Timing:</strong> ${fnotes.timing}</p>
        <p><strong>Key points:</strong></p>
        <ul>${fnotes.keyPoints.map(p => `<li>${p}</li>`).join('')}</ul>
        <p><strong>Expected dynamics:</strong></p>
        <ul>${fnotes.expectedDynamics.map(p => `<li>${p}</li>`).join('')}</ul>
      </div>
    </details>`;
  }

  html += renderCO2Meter(d.ppm, config);

  if (d.catastrophe) {
    const ctx = ppmContext(d.ppm);
    html += `<div class="catastrophe-overlay card" role="alert">
      <h3>Catastrophe threshold breached</h3>
      <p>Emissions exceeded the safe limit of <strong>${fmt(config.triggerPpm)} ppm</strong>.</p>
      <p class="catastrophe-context">${ctx.description}</p>
    </div>`;
  }

  const cleanTechPending = regimeUsesCleanTech(regime) && d.currentRound === 0
    && d.rounds.length === 0 && !cleanTechDecisionMade[regime];

  if (regimeUsesCleanTech(regime) && d.currentRound === 0 && d.rounds.length === 0) {
    html += renderCleanTechDecision(regime, d, config);
  }

  if (regimeUsesPermits(regime) && d.currentRound === 0 && d.rounds.length === 0 && !cleanTechPending) {
    html += renderPermitInfo(regime, d, config);
  }

  if (!roundDone && !cleanTechPending) {
    html += renderPlayerInput(regime, d, config);
  }

  if (regimeHasPermitMarket(regime) && !roundDone && d.rounds.length > 0) {
    html += renderTradePanel(regime, d, config);
  }

  if (d.rounds.length > 0) {
    html += renderRoundHistory(regime, d);
  }

  if (roundDone) {
    html += `<div class="card text-center">
      <button class="btn btn-primary btn-block" onclick="window.soloApp.goToDebrief()" style="font-size:1rem;padding:0.7rem;">
        View Regime Summary &amp; Debrief &rarr;
      </button>
    </div>`;
  }

  return html;
}

/* ── Clean-tech decision ── */

function renderCleanTechDecision(regime, d, config) {
  const maxSlots = config.maxCleanTech || 2;
  const playerHas = d.firms[PLAYER_FIRM].cleanTech;
  const slotsUsed = d.firms.filter(f => f.cleanTech).length;
  const decided = cleanTechDecisionMade[regime];

  if (decided && playerHas) {
    return `<div class="card" style="border-color:var(--success);">
      <h3>Clean Technology</h3>
      <p style="font-size:0.88rem;">Your firm has <strong>clean technology</strong> this regime (${slotsUsed} of ${maxSlots} slots in use).
        Clean tech halves your emissions per unit but costs ${fmtMoney(config.cleanTechCost)} setup each round you produce.</p>
    </div>`;
  }

  if (decided && !playerHas) {
    return `<div class="card">
      <h3>Clean Technology</h3>
      <p style="font-size:0.88rem;">Your firm is on <strong>standard</strong> technology this regime.
        ${slotsUsed} of ${maxSlots} clean-tech slots are in use by AI firms.</p>
    </div>`;
  }

  return `<div class="card">
    <h3>Clean Technology</h3>
    <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.6rem;">
      Up to <strong>${maxSlots}</strong> firms may claim clean technology.
      <strong>1 slot is reserved for you.</strong>
    </p>
    <div class="info-box accent" style="font-size:0.85rem;margin-bottom:0.75rem;">
      <strong>Trade-off:</strong> Clean tech halves your emissions per unit and halves your tax rate (in the Carbon Tax regime),
      but costs <strong>${fmtMoney(config.cleanTechCost)}</strong> setup each round you produce.
      In early rounds this makes clean-tech firms less profitable, but it pays off as capital grows.
    </div>
    <div style="display:flex;gap:0.5rem;">
      <button class="btn btn-success" style="flex:1;" onclick="window.soloApp.claimCleanTech('${regime}', true)">
        Claim Clean Tech
      </button>
      <button class="btn btn-outline" style="flex:1;" onclick="window.soloApp.claimCleanTech('${regime}', false)">
        Stay Standard
      </button>
    </div>
  </div>`;
}

/* ── Permit info ── */

function renderPermitInfo(regime, d, config) {
  const perFirm = defaultPermitsPerFirm(config);
  return `<div class="card">
    <h3>Permit Allocation</h3>
    <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.5rem;">
      Each firm receives <strong>${perFirm}</strong> permits.
      Each permit covers ${config.ppmPer1000} ppm CO\u2082 = <strong>1,000</strong> units (standard) or <strong>2,000</strong> units (clean tech).
    </p>
    <table>
      <thead><tr><th>Firm</th><th class="num">Permits</th><th class="num">Units/permit</th><th class="num">Max production</th></tr></thead>
      <tbody>
        ${state.firms.map((f, i) => {
          const fd = d.firms[i];
          const upp = unitsPerPermit(fd);
          return `<tr>
            <td style="color:${firmColor(i)};font-weight:600;">${f.name}${i === PLAYER_FIRM ? ' (You)' : ''}</td>
            <td class="num">${fd.permits}</td>
            <td class="num">${fmt(upp)}</td>
            <td class="num">${fmt(fd.permits * upp)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

/* ── Player production input ── */

function renderPlayerInput(regime, d, config) {
  const fd = d.firms[PLAYER_FIRM];
  const maxAllowed = maxAllowedProduction(fd, config, regime);
  const isCaC = regimeHasCap(regime);
  const isTrade = regimeUsesPermits(regime);

  let constraints = `Available capital: ${fmtMoney(fd.capital)}`;
  if (isCaC) constraints += ` | Production cap: ${fmt(config.cacCap)}`;
  if (isTrade) {
    const pr = permitsRemaining(fd);
    const upp = unitsPerPermit(fd);
    constraints += ` | Permits remaining: ${fmt(pr)} (=${fmt(pr * upp)} units)`;
  }

  return `<div class="submit-section">
    <h3>Round ${d.currentRound + 1} of ${config.numRounds}</h3>
    <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.4rem;">${constraints}</p>
    <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.6rem;">
      Maximum you can produce: <strong>${fmt(maxAllowed)}</strong>
    </p>
    ${renderCalculator(regime, fd, config)}
    <label for="soloProd" style="margin-top:0.75rem;">Your production decision:</label>
    <input type="number" id="soloProd" min="0" max="${maxAllowed}" value="0" step="1" inputmode="numeric" pattern="[0-9]*">
    <br>
    <button class="btn btn-success" onclick="window.soloApp.submitRound('${regime}')" style="margin-top:0.5rem;">
      Submit Round ${d.currentRound + 1}
    </button>
  </div>`;
}

/* ── Calculator ── */

function renderCalculator(regime, fd, config) {
  const isTax = regimeUsesTax(regime);
  const isClean = fd.cleanTech;

  let info = `Revenue: ${fmtMoney(config.revenuePerUnit)}/unit | Cost: ${fmtMoney(config.costPerUnit)}/unit`;
  if (isTax) {
    const rate = isClean ? config.taxRate / 2 : config.taxRate;
    info += ` | Tax: ${fmtMoney(rate)}/unit`;
  }
  if (isClean) {
    info += ` | Setup: ${fmtMoney(config.cleanTechCost)}/round`;
  }

  return `<div class="calculator-box" style="text-align:left;margin-bottom:0.5rem;">
    <h3>Profit Calculator</h3>
    <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">${info}</div>
    <label>Simulate production:</label>
    <input type="number" id="calcInput" min="0" value="0" oninput="window.soloApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;" step="1" inputmode="numeric">
    <div class="calculator-result" id="calcResult">Enter a number above</div>
  </div>`;
}

/* ── Permit trade panel ── */

function renderTradePanel(regime, d, config) {
  const trades = d.trades || [];
  const playerFd = d.firms[PLAYER_FIRM];
  const playerRemaining = permitsRemaining(playerFd);

  const holdingsRows = state.firms.map((f, i) => {
    const fd = d.firms[i];
    const pr = permitsRemaining(fd);
    const reservation = i !== PLAYER_FIRM ? aiReservationPrice(i, fd, config, regime) : null;
    return `<tr>
      <td style="color:${firmColor(i)};font-weight:600;">${f.name}${i === PLAYER_FIRM ? ' (You)' : ''}</td>
      <td class="num">${fmt(fd.permits)}</td>
      <td class="num">${fmt(pr)}</td>
      <td class="num">${fmtMoney(fd.capital)}</td>
      <td class="num">${reservation !== null ? fmtMoney(reservation) : '\u2014'}</td>
    </tr>`;
  }).join('');

  const aiFirmOptions = state.firms
    .map((f, i) => i !== PLAYER_FIRM ? `<option value="${i}">${f.name}</option>` : '')
    .filter(Boolean).join('');

  const tradeLog = trades.length ? `<div class="trade-log" style="margin-top:0.75rem;">
    <h4 style="font-size:0.88rem;">Trade Log</h4>
    <table><thead><tr><th>#</th><th>Seller</th><th>Buyer</th><th class="num">Qty</th><th class="num">$/permit</th></tr></thead>
    <tbody>${trades.map((t, ti) => `<tr>
      <td>${ti + 1}</td>
      <td style="color:${firmColor(t.seller)};">${state.firms[t.seller].name}</td>
      <td style="color:${firmColor(t.buyer)};">${state.firms[t.buyer].name}</td>
      <td class="num">${fmt(t.quantity)}</td>
      <td class="num">${fmtMoney(t.price)}</td>
    </tr>`).join('')}</tbody></table>
  </div>` : '';

  return `<div class="card">
    <h3>Permit Market</h3>
    <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.75rem;">
      Each AI firm has a <strong>reservation price</strong> — the minimum they will accept to sell a permit
      (or maximum they will pay to buy one). Propose trades below.
    </p>
    <table>
      <thead><tr><th>Firm</th><th class="num">Held</th><th class="num">Avail</th><th class="num">Capital</th><th class="num">Reservation $</th></tr></thead>
      <tbody>${holdingsRows}</tbody>
    </table>

    <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border);">
      <h4 style="font-size:0.88rem;margin-bottom:0.5rem;">Propose a Trade</h4>
      <div class="two-col">
        <div class="form-group">
          <label>Direction</label>
          <select id="tradeDirection">
            <option value="buy">You BUY permits from AI</option>
            <option value="sell">You SELL permits to AI</option>
          </select>
        </div>
        <div class="form-group">
          <label>AI Firm</label>
          <select id="tradePartner">${aiFirmOptions}</select>
        </div>
      </div>
      <div class="two-col">
        <div class="form-group">
          <label>Permits</label>
          <input type="number" id="tradeQty" min="1" value="1" step="1" inputmode="numeric">
        </div>
        <div class="form-group">
          <label>Price per permit ($)</label>
          <input type="number" id="tradePrice" min="0" step="1" value="0" inputmode="numeric">
        </div>
      </div>
      <div id="tradeError" class="form-error hidden" style="margin-bottom:0.5rem;"></div>
      <div id="tradeSuccess" class="info-box success hidden" style="margin-bottom:0.5rem;"></div>
      <button class="btn btn-success" onclick="window.soloApp.proposeTrade('${regime}')">Propose Trade</button>
    </div>
    ${tradeLog}
  </div>`;
}

/* ── Round history ── */

function renderRoundHistory(regime, d) {
  const config = state.config;
  const rows = d.rounds.map((r, ri) => {
    const firmCells = state.firms.map((_, fi) => {
      const prod = Number(r.production?.[fi]) || 0;
      const profit = Number(r.profitByFirm?.[fi]) || 0;
      return `<td class="num">${fmt(prod)}<div class="sub-cell-note">${fmtMoney(profit)}</div></td>`;
    }).join('');
    return `<tr>
      <td>R${ri + 1}</td>
      ${firmCells}
      <td class="num">${fmt(r.totalProduction)}</td>
      <td class="num">${fmt(r.ppmAfter)}</td>
    </tr>`;
  }).join('');

  return `<div class="card">
    <h3>Production History</h3>
    <div style="overflow-x:auto;">
    <table>
      <thead><tr>
        <th></th>
        ${state.firms.map((f, i) => `<th class="num" style="color:${firmColor(i)};">${f.name}${i === PLAYER_FIRM ? ' (You)' : ''}<div class="sub-cell-note">Prod / Profit</div></th>`).join('')}
        <th class="num">Total</th>
        <th class="num">CO\u2082</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
  </div>`;
}

/* ── Debrief screen ── */

function renderDebriefScreen() {
  if (!state) return '';
  const regime = state.regime;
  const d = state.regimeData[regime];
  if (!d) return '';
  const config = state.config;
  const nextRegime = nextRegimeAfter(config, regime);
  const nextLabel = nextRegime === 'results' ? 'Final Results' : REGIME_LABELS[nextRegime];
  const isLast = nextRegime === 'results';

  let html = '';

  html += `<div class="card"><h2>Regime Summary: ${REGIME_LABELS[regime]}</h2>`;

  if (regime !== 'freemarket') {
    const dwl = computeDeadweightLoss(state, regime);
    html += `<div class="dwl-box">
      <div class="dwl-label">Deadweight Loss (vs. free market)</div>
      <div class="dwl-value">${fmtMoney(dwl)}</div>
    </div>`;
    const totalProfit = d.firms.reduce((s, f) => s + f.totalProfit, 0);
    const analog = dwlAnalogy(dwl, totalProfit);
    if (analog) {
      html += `<div class="dwl-analogy-box"><p>${analog}</p></div>`;
    }
  }

  const showTax = regime === 'tax';
  const showPermit = regime === 'trade' || regime === 'trademarket';
  html += `<table>
    <thead><tr><th>Firm</th><th class="num">Produced</th>${showTax ? '<th class="num">Tax Paid</th>' : ''}${showPermit ? '<th class="num">Unused Permits</th>' : ''}<th class="num">Total Profit</th><th class="num">Final Capital</th></tr></thead>
    <tbody>
      ${state.firms.map((f, i) => {
        const fd = d.firms[i];
        return `<tr>
          <td style="color:${firmColor(i)};font-weight:600;">${f.name}${i === PLAYER_FIRM ? ' (You)' : ''}</td>
          <td class="num">${fmt(fd.totalProduced)}</td>
          ${showTax ? `<td class="num">${fmtMoney(totalTaxPaidByFirm(d, i, config))}</td>` : ''}
          ${showPermit ? `<td class="num">${fmt(permitsRemaining(fd))}</td>` : ''}
          <td class="num">${fmtMoney(fd.totalProfit)}</td>
          <td class="num">${fmtMoney(fd.capital)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  html += `<div class="stat-row"><span class="stat-label">Catastrophe triggered?</span>
    <span class="stat-value">${d.catastrophe ? 'Yes' : 'No'}</span></div>`;

  html += '</div>';

  const ppmCtx = ppmContext(d.ppm);
  html += `<div class="ppm-context-box" style="border-color:${ppmCtx.colour};">
    <div class="ppm-context-level" style="color:${ppmCtx.colour};">${ppmCtx.level}</div>
    <p>${ppmCtx.description}</p>
    <div class="ppm-context-source">Source: IPCC AR6 Synthesis Report (2023)</div>
  </div>`;

  html += renderCO2Meter(d.ppm, config);

  const commentary = educatorCommentary(regime);
  if (commentary) {
    html += `<div class="card educator-commentary">
      <h3>Educator Commentary</h3>
      ${commentary}
    </div>`;
  }

  const prompt = debriefPrompt(regime);
  const existingProposal = playerProposals[regime] || '';
  html += `<div class="debrief-student-card">
    <h3>What would you change?</h3>
    <p style="font-size:0.88rem;margin-bottom:0.6rem;">${prompt.question}</p>
    ${prompt.hint ? `<p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.8rem;font-style:italic;">${prompt.hint}</p>` : ''}
    <textarea id="proposalText" rows="4" placeholder="Type your thoughts here (optional)…"
              style="width:100%;resize:vertical;font-family:inherit;font-size:0.88rem;padding:0.6rem;border:1px solid var(--border);border-radius:0.5rem;">${existingProposal}</textarea>
    <button class="btn btn-outline mt-1" onclick="window.soloApp.saveProposal('${regime}')">Save Response</button>
  </div>`;

  if (!isLast) {
    html += `<div class="next-regime-preview">
      <div class="next-regime-label">Coming next</div>
      <strong>${nextLabel}</strong>
      <div style="font-size:0.82rem;margin-top:0.3rem;color:var(--text-secondary);">${regimeDescription(nextRegime, config)}</div>
    </div>`;
  }

  html += `<div class="card text-center mt-1">
    <button class="btn btn-primary btn-block" onclick="window.soloApp.advanceRegime()" style="font-size:1rem;padding:0.7rem;">
      ${isLast ? 'View Final Results' : `Continue to ${nextLabel}`} &rarr;
    </button>
  </div>`;

  return html;
}

/* ── Results screen ── */

function renderResultsScreen() {
  if (!state) return '';
  const seq = sessionRegimes();
  const completed = state.completedRegimes.filter(r => seq.includes(r));

  if (completed.length === 0) {
    return '<div class="card"><h2>Results</h2><p>No regimes completed yet.</p></div>';
  }

  const config = state.config;

  const crossRegimeRows = completed.map(r => {
    const d = state.regimeData[r];
    const totalProd = d.firms.reduce((s, f) => s + f.totalProduced, 0);
    const totalProfit = d.firms.reduce((s, f) => s + f.totalProfit, 0);
    const dwl = r === 'freemarket' ? '\u2014' : fmtMoney(computeDeadweightLoss(state, r));
    return `<tr>
      <td><strong>${REGIME_LABELS[r]}</strong></td>
      <td class="num">${fmt(totalProd)}</td>
      <td class="num">${fmt(d.ppm)}</td>
      <td class="num">${d.catastrophe ? 'Yes' : 'No'}</td>
      <td class="num">${fmtMoney(totalProfit)}</td>
      <td class="num">${dwl}</td>
    </tr>`;
  }).join('');

  const firmCompRows = state.firms.map((f, i) => {
    const cells = completed.map(r => {
      const fd = state.regimeData[r].firms[i];
      return `<td class="num">${fmtMoney(fd.totalProfit)}</td>`;
    }).join('');
    return `<tr><td style="color:${firmColor(i)};font-weight:600;">${f.name}${i === PLAYER_FIRM ? ' (You)' : ''}</td>${cells}</tr>`;
  }).join('');

  let proposalReview = '';
  const proposalEntries = Object.entries(playerProposals).filter(([_, v]) => v.trim());
  if (proposalEntries.length > 0) {
    proposalReview = `<div class="card">
      <h3>Your Debrief Responses</h3>
      ${proposalEntries.map(([r, text]) => `<div class="proposal-card" style="border-left:3px solid ${firmColor(PLAYER_FIRM)};margin-bottom:0.5rem;">
        <div style="font-weight:600;font-size:0.85rem;">${REGIME_LABELS[r]}</div>
        <div style="font-size:0.88rem;margin-top:0.25rem;">${text}</div>
      </div>`).join('')}
    </div>`;
  }

  let aiReveal = `<div class="card educator-commentary">
    <h3>AI Firm Strategy Reveal</h3>
    <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.75rem;">
      The four AI firms were pre-assigned hidden personality types that determined their decision-making:
    </p>
    ${state.firms.filter((_, i) => i !== PLAYER_FIRM).map((f, idx) => {
      const i = idx + 1;
      const p = getPersonality(i);
      const pInfo = PERSONALITIES[p];
      return `<div style="display:flex;gap:0.75rem;align-items:flex-start;margin-bottom:0.75rem;padding:0.65rem;background:#fafbfc;border-radius:0.5rem;border-left:3px solid ${firmColor(i)};">
        <div>
          <div style="font-weight:600;color:${firmColor(i)};">${f.name}</div>
          <div style="font-size:0.82rem;margin-top:0.15rem;"><strong>${pInfo.label}</strong></div>
          <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.25rem;">${pInfo.description}</div>
        </div>
      </div>`;
    }).join('')}
  </div>`;

  let discussionHtml = `<div class="card">
    <h2>Discussion</h2>
    <div class="debrief-box" style="background:#eaf2f8;border-color:#aed6f1;">
      <h3 style="color:#2471a3;">Material Viability</h3>
      <ul>
        <li>Which approach actually kept emissions under ${config.triggerPpm} ppm?</li>
        <li>Carbon tax gives price certainty but quantity uncertainty. A cap gives quantity certainty; adding trade reallocates permits efficiently.</li>
      </ul>
    </div>
    <div class="debrief-box" style="background:#fef5e7;border-color:#f9e2b0;">
      <h3 style="color:#e67e22;">Normative Desirability</h3>
      <ul>
        <li>Which approach distributed costs most fairly? Who bore the greatest burden?</li>
        <li>Did any approach achieve a distribution where firms bear the true costs of their pollution?</li>
      </ul>
    </div>
    <div class="debrief-box" style="background:#fdf2f2;border-color:#f5c6cb;">
      <h3 style="color:#c0392b;">Political Feasibility</h3>
      <ul>
        <li>Which approach was most vulnerable to gaming, lobbying, and manipulation?</li>
        <li>If firms can lobby to weaken the cap, or the tax is set too low, can any mechanism work as designed?</li>
      </ul>
    </div>
  </div>`;

  return `
    <div class="card">
      <h2>Cross-Regime Comparison</h2>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Regime</th><th class="num">Total Prod.</th><th class="num">Final ppm</th><th class="num">Catastrophe?</th><th class="num">Total Profit</th><th class="num">DWL</th></tr></thead>
        <tbody>${crossRegimeRows}</tbody>
      </table>
      </div>
    </div>

    <div class="card">
      <h3>Profit by Firm Across Regimes</h3>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Firm</th>${completed.map(r => `<th class="num">${REGIME_LABELS[r]}</th>`).join('')}</tr></thead>
        <tbody>${firmCompRows}</tbody>
      </table>
      </div>
    </div>

    <div class="card chart-card">
      <h2>Charts</h2>
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.75rem;">
        CO\u2082 concentration and profit comparison across all completed regimes.
      </p>
      <div class="chart-wrap">
        <canvas id="chartPpmByRound"></canvas>
      </div>
      <div class="chart-wrap" style="margin-top:1.25rem;">
        <canvas id="chartProfitByFirm"></canvas>
      </div>
    </div>

    ${aiReveal}
    ${proposalReview}
    ${discussionHtml}

    <div class="card text-center">
      <button class="btn btn-primary" onclick="window.soloApp.playAgain()">Play Again</button>
    </div>`;
}

/* ── Charts ── */

function destroyCharts() {
  chartInstances.forEach(ch => { try { ch.destroy(); } catch (_) {} });
  chartInstances = [];
}

function mountResultsCharts() {
  if (typeof Chart === 'undefined' || !state) return;
  const seq = sessionRegimes();
  const completed = state.completedRegimes.filter(r => seq.includes(r));
  if (completed.length === 0) return;

  const maxR = Math.max(...completed.map(r => state.regimeData[r].rounds.length), 1);
  const ppmLabels = Array.from({ length: maxR + 1 }, (_, i) => (i === 0 ? 'Start' : `Round ${i}`));

  const ppmDatasets = completed.map(r => {
    const d = state.regimeData[r];
    const pts = [state.config.startPpm];
    for (const round of d.rounds) pts.push(round.ppmAfter);
    while (pts.length < maxR + 1) pts.push(pts[pts.length - 1]);
    return {
      label: REGIME_LABELS[r],
      data: pts.slice(0, maxR + 1),
      borderColor: CHART_REGIME_COLORS[r] || '#333',
      backgroundColor: 'transparent',
      tension: 0.15,
      fill: false,
    };
  });

  const elPpm = document.getElementById('chartPpmByRound');
  if (elPpm) {
    chartInstances.push(new Chart(elPpm, {
      type: 'line',
      data: { labels: ppmLabels, datasets: ppmDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2,
        plugins: {
          title: { display: true, text: 'CO\u2082 concentration (ppm) after each round' },
          legend: { position: 'bottom' },
        },
        scales: { y: { title: { display: true, text: 'ppm' } } },
      },
    }));
  }

  const firmLabels = state.firms.map((f, i) => i === PLAYER_FIRM ? `${f.name} (You)` : f.name);
  const profitDatasets = completed.map(r => ({
    label: REGIME_LABELS[r],
    data: state.firms.map((_, i) => state.regimeData[r].firms[i].totalProfit),
    backgroundColor: CHART_REGIME_COLORS[r] || '#888',
  }));

  const elBar = document.getElementById('chartProfitByFirm');
  if (elBar) {
    chartInstances.push(new Chart(elBar, {
      type: 'bar',
      data: { labels: firmLabels, datasets: profitDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1.6,
        plugins: {
          title: { display: true, text: 'Total profit by firm ($)' },
          legend: { position: 'bottom' },
        },
        scales: {
          x: { title: { display: true, text: 'Firm' } },
          y: { title: { display: true, text: 'Profit ($)' } },
        },
      },
    }));
  }
}

/* ── Actions (exposed on window) ── */

window.soloApp = {
  startGame() {
    startGame();
  },

  claimCleanTech(regime, claim) {
    if (!state) return;
    const d = state.regimeData[regime];

    const aiClaims = aiCleanTechDecisions(state.config, regime, d, PLAYER_FIRM);
    for (const i of aiClaims) {
      d.firms[i].cleanTech = true;
    }

    if (claim) {
      d.firms[PLAYER_FIRM].cleanTech = true;
    }

    cleanTechDecisionMade[regime] = true;

    if (regimeUsesPermits(regime)) {
      const perFirm = defaultPermitsPerFirm(state.config);
      d.firms.forEach(fd => { if (fd.permits === 0) fd.permits = perFirm; });
    }

    render();
  },

  submitRound(regime) {
    if (!state) return;
    const d = state.regimeData[regime];
    const config = state.config;
    const input = document.getElementById('soloProd');
    if (!input) return;

    const raw = parseInt(input.value, 10);
    if (isNaN(raw) || raw < 0) return;
    const playerProd = Math.min(raw, maxAllowedProduction(d.firms[PLAYER_FIRM], config, regime));

    const production = [playerProd];
    for (let i = 1; i < config.numFirms; i++) {
      production.push(aiProductionDecision(i, d.firms[i], config, regime, d));
    }

    processRound(state, regime, production);
    render();
  },

  proposeTrade(regime) {
    if (!state) return;
    const d = state.regimeData[regime];
    const config = state.config;
    const errEl = document.getElementById('tradeError');
    const successEl = document.getElementById('tradeSuccess');
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
    if (successEl) { successEl.classList.add('hidden'); successEl.textContent = ''; }

    const direction = document.getElementById('tradeDirection')?.value;
    const partner = parseInt(document.getElementById('tradePartner')?.value, 10);
    const qty = parseInt(document.getElementById('tradeQty')?.value, 10);
    const price = parseFloat(document.getElementById('tradePrice')?.value);

    if (isNaN(partner) || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
      if (errEl) { errEl.textContent = 'Please fill in all trade fields with valid values.'; errEl.classList.remove('hidden'); }
      return;
    }

    const partnerFd = d.firms[partner];
    const aiRole = direction === 'buy' ? 'sell' : 'buy';
    const evaluation = aiEvaluateTrade(partner, partnerFd, config, regime, aiRole, qty, price);

    if (!evaluation.accept) {
      if (errEl) { errEl.textContent = `Trade rejected: ${evaluation.reason}`; errEl.classList.remove('hidden'); }
      return;
    }

    const seller = direction === 'buy' ? partner : PLAYER_FIRM;
    const buyer = direction === 'buy' ? PLAYER_FIRM : partner;
    const result = processPermitTrade(state, regime, seller, buyer, qty, price);

    if (result.error) {
      if (errEl) { errEl.textContent = result.error; errEl.classList.remove('hidden'); }
      return;
    }

    if (successEl) {
      const verb = direction === 'buy' ? 'Bought' : 'Sold';
      successEl.textContent = `${verb} ${qty} permit(s) at $${price} each with ${state.firms[partner].name}.`;
      successEl.classList.remove('hidden');
    }
    render();
  },

  updateCalc(regime) {
    const input = document.getElementById('calcInput');
    const result = document.getElementById('calcResult');
    if (!input || !result || !state) return;
    const qty = parseInt(input.value) || 0;
    if (qty <= 0) { result.textContent = 'Enter a number above'; return; }

    const config = state.config;
    const fd = state.regimeData[regime].firms[PLAYER_FIRM];
    const detail = roundProfitDetailForFirm(regime, config, fd, qty);
    const ppmAdded = (qty / 1000) * (fd.cleanTech ? config.ppmPer1000 / 2 : config.ppmPer1000);

    result.innerHTML = `Profit: <strong>${fmtMoney(detail.profit)}</strong> | CO\u2082: +${fmt(ppmAdded)} ppm${detail.tax > 0 ? ` | Tax: ${fmtMoney(detail.tax)}` : ''}${detail.setup > 0 ? ` | Setup: ${fmtMoney(detail.setup)}` : ''}`;
  },

  goToDebrief() {
    currentScreen = 'debrief';
    render();
    window.scrollTo(0, 0);
  },

  saveProposal(regime) {
    const textarea = document.getElementById('proposalText');
    if (textarea) {
      playerProposals[regime] = textarea.value.trim();
    }
  },

  advanceRegime() {
    if (!state) return;
    const regime = state.regime;

    const textarea = document.getElementById('proposalText');
    if (textarea) {
      playerProposals[regime] = textarea.value.trim();
    }

    completeRegime(state, regime);
    const next = nextRegimeAfter(state.config, regime);

    if (next === 'results') {
      state.regime = 'results';
      currentScreen = 'results';
    } else {
      state.regime = next;
      const d = state.regimeData[next];

      if (regimeUsesCleanTech(next)) {
        currentScreen = 'regime';
      } else {
        if (regimeUsesPermits(next)) {
          const perFirm = defaultPermitsPerFirm(state.config);
          d.firms.forEach(fd => { if (fd.permits === 0) fd.permits = perFirm; });
        }
        currentScreen = 'regime';
      }
    }

    render();
    window.scrollTo(0, 0);
  },

  viewRegimeTab(regime) {
    if (!state) return;
    if (!state.completedRegimes.includes(regime) && state.regime !== regime) return;
    state.regime = regime;
    const d = state.regimeData[regime];
    if (d && d.currentRound >= state.config.numRounds) {
      currentScreen = 'debrief';
    } else {
      currentScreen = 'regime';
    }
    render();
  },

  viewResults() {
    if (!state) return;
    currentScreen = 'results';
    render();
  },

  playAgain() {
    state = null;
    currentScreen = 'welcome';
    playerProposals = {};
    cleanTechDecisionMade = {};
    render();
  },
};

/* ── Bootstrap ── */

render();
