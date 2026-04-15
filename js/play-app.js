/**
 * Play (Student) App — mobile-first view for student firms.
 */

import {
  REGIMES, REGIME_LABELS, buildConfig, maxAllowedProduction, unitsPerPermit,
  permitsRemaining, normalizeStateFromRemote, maxAffordable, maxProductionFromPermits,
  totalTaxPaidByFirm,
} from './game-engine.js';
import { onStateChange, submitDecision, registerStudent, submitProposal } from './firebase-sync.js';
import { fmt, fmtMoney, renderCO2Meter, firmColor, cleanBadge, regimeUsesCleanTech, regimeUsesTax, regimeUsesPermits, regimeHasCap, regimeHasPermitMarket, regimeDescription, debriefPrompt, ppmContext } from './ui-helpers.js';

/* ── Globals ── */

const params = new URLSearchParams(window.location.search);
const ROOM = params.get('room');
const FIRM_ID = parseInt(params.get('firm'), 10);
if (!ROOM || isNaN(FIRM_ID)) { window.location.href = 'index.html'; }

let state = null;
let hasSubmitted = {};
let submissionClampNotes = {};
let hasProposed = {};

/** Simulated clean-tech for calculator only (not actual firm state). */
let calcSimCleanTech = false;
let calcSimContextKey = null;

function ensureCalcSim(regime, fd, round) {
  const key = `${regime}_${round}`;
  if (calcSimContextKey !== key) {
    calcSimContextKey = key;
    calcSimCleanTech = !!fd.cleanTech;
  }
}

function buildClampMessage(regime, fd, config, raw, applied) {
  if (raw <= applied) return '';
  const maxAllowed = maxAllowedProduction(fd, config, regime);
  const afford = maxAffordable(fd, config);
  const reasons = [];
  if (afford === maxAllowed) reasons.push('available capital');
  if (regime === 'cac' && config.cacCap === maxAllowed) reasons.push('the per-firm production cap for this round');
  if ((regime === 'trade' || regime === 'trademarket') && maxProductionFromPermits(fd) === maxAllowed) {
    reasons.push('your remaining permit capacity');
  }
  const joint = reasons.length === 0
    ? 'the applicable round limit'
    : (reasons.length === 1 ? reasons[0] : reasons.join(' and '));
  return `You entered ${fmt(raw)}; your submission was recorded as ${fmt(applied)} (limited by ${joint}).`;
}

const content = document.getElementById('content');
const firmNameEl = document.getElementById('firmNameHeader');

/* ── Init ── */

async function init() {
  await registerStudent(ROOM, FIRM_ID);

  onStateChange(ROOM, newState => {
    state = normalizeStateFromRemote(newState);
    if (!state) {
      content.innerHTML = `<div class="card"><h2>Room not found</h2><p>No game state for this room. <a href="index.html">Return to join page</a></p></div>`;
      return;
    }
    state.config = buildConfig(state.config);
    const rd = state.regimeData[state.regime];
    console.log(`[STUDENT] onStateChange: regime=${state.regime}, currentRound=${rd ? rd.currentRound : 'N/A'}`);
    render();
  });
}

/* ── Render ── */

function render() {
  if (!state) {
    content.innerHTML = '<div class="waiting-indicator"><div class="spinner"></div><p>Connecting to game…</p></div>';
    return;
  }

  const firm = state.firms[FIRM_ID];
  if (firmNameEl) firmNameEl.textContent = firm ? firm.name : `Firm ${FIRM_ID + 1}`;

  switch (state.regime) {
    case 'setup': content.innerHTML = renderWaiting('The facilitator is setting up the game. Please wait…'); break;
    case 'results': content.innerHTML = renderResults(); break;
    default:
      if (REGIMES.includes(state.regime)) content.innerHTML = renderRegime(state.regime);
      else content.innerHTML = renderWaiting('Waiting for the facilitator…');
  }
}

function renderWaiting(msg) {
  return `<div class="waiting-indicator"><div class="spinner"></div><p>${msg}</p></div>`;
}

/* ── Regime view ── */

function renderRegime(regime) {
  const d = state.regimeData[regime];
  if (!d) return renderWaiting('Loading regime data…');
  const config = state.config;
  const fd = d.firms[FIRM_ID];
  const firm = state.firms[FIRM_ID];
  const roundDone = d.currentRound >= config.numRounds;
  const usesClean = regimeUsesCleanTech(regime);
  const isTax = regimeUsesTax(regime);
  const isTrade = regimeUsesPermits(regime);
  const isCaC = regimeHasCap(regime);

  let html = '';

  html += `
    <div class="student-firm-header" style="border-color:${firmColor(FIRM_ID)};">
      <div class="firm-name-large" style="color:${firmColor(FIRM_ID)};">${firm.name}</div>
      ${usesClean ? `<div>${cleanBadge(fd)}</div>` : ''}
      <div class="firm-capital">${fmtMoney(fd.capital)}</div>
      <div style="font-size:0.82rem;color:var(--text-secondary);">Available capital</div>
    </div>
  `;

  html += `
    <div class="card">
      <h3>${REGIME_LABELS[regime]}</h3>
      <div class="info-box accent" style="font-size:0.85rem;">${regimeDescription(regime, config)}</div>
    </div>
  `;

  html += renderCO2Meter(d.ppm, config);

  if (isTrade) {
    const pr = permitsRemaining(fd);
    const upp = unitsPerPermit(fd);
    html += `
      <div class="card">
        <h3>Your Permits</h3>
        <div class="stat-row"><span class="stat-label">Permits held</span><span class="stat-value">${fmt(fd.permits)}</span></div>
        <div class="stat-row"><span class="stat-label">Permits remaining</span><span class="stat-value">${fmt(pr)}</span></div>
        <div class="stat-row"><span class="stat-label">Units per permit</span><span class="stat-value">${fmt(upp)}</span></div>
        <div class="stat-row"><span class="stat-label">Max production from permits</span><span class="stat-value">${fmt(pr * upp)}</span></div>
      </div>`;
  }

  if (!roundDone) ensureCalcSim(regime, fd, d.currentRound);
  html += renderCalculator(regime, fd, config);

  if (!roundDone) {
    const roundKey = `${regime}_${d.currentRound}`;
    const alreadySubmitted = hasSubmitted[roundKey];
    const maxAllowed = maxAllowedProduction(fd, config, regime);
    const clampNote = submissionClampNotes[roundKey] || '';

    if (alreadySubmitted) {
      html += `
        <div class="submit-section" style="border-color:var(--success);">
          <h3 style="color:var(--success);">Decision submitted!</h3>
          <p style="font-size:0.88rem;color:var(--text-secondary);">
            You submitted <strong>${fmt(alreadySubmitted)}</strong> thingamabobs for Round ${d.currentRound + 1}.
            Waiting for the facilitator to process…
          </p>
          ${clampNote ? `<p style="font-size:0.82rem;color:var(--warn);margin-top:0.5rem;">${clampNote}</p>` : ''}
        </div>`;
    } else {
      html += `
        <div class="submit-section">
          <h3>Round ${d.currentRound + 1} of ${config.numRounds}</h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.6rem;">
            How many thingamabobs will you produce?
            ${isCaC ? `(Cap: ${fmt(config.cacCap)})` : ''}
            (Max: ${fmt(maxAllowed)})
          </p>
          <input type="number" id="studentProd" min="0" max="${maxAllowed}" value="0">
          <br>
          <button class="btn btn-success" onclick="window.playApp.submitProd('${regime}', ${d.currentRound}, ${maxAllowed})">
            Submit Decision
          </button>
        </div>`;
    }
  } else {
    html += renderFirmSummary(regime, d, fd);
    html += renderDebriefPrompt(regime, d);
  }

  if (d.rounds.length > 0) {
    html += renderMyHistory(d);
  }

  return html;
}

/* ── Calculator ── */

function renderCleanTechSimToggle(regime, fd) {
  if (!regimeUsesCleanTech(regime)) return '';
  const sim = calcSimCleanTech;
  return `
    <div class="calc-sim-toggle" style="margin-bottom:0.65rem;font-size:0.82rem;">
      <span style="color:var(--text-secondary);display:block;margin-bottom:0.35rem;">Simulate production as:</span>
      <label style="display:inline-flex;align-items:center;margin-right:1rem;cursor:pointer;">
        <input type="radio" name="calcSimClean" ${!sim ? 'checked' : ''} onchange="window.playApp.setCalcSimCleanTech(false)">
        <span style="margin-left:0.35rem;">Standard</span>
      </label>
      <label style="display:inline-flex;align-items:center;cursor:pointer;">
        <input type="radio" name="calcSimClean" ${sim ? 'checked' : ''} onchange="window.playApp.setCalcSimCleanTech(true)">
        <span style="margin-left:0.35rem;">Clean tech</span>
      </label>
      ${sim !== fd.cleanTech ? `<div style="margin-top:0.4rem;color:var(--text-secondary);font-style:italic;">Your firm is assigned <strong>${fd.cleanTech ? 'clean tech' : 'standard'}</strong> in this regime; this toggle is for comparison only.</div>` : ''}
    </div>`;
}

function renderProfitBreakdown(regime, config, fd) {
  const rev = fmtMoney(config.revenuePerUnit);
  const cost = fmtMoney(config.costPerUnit);
  const pp = fmtMoney(config.profitPerUnit);
  const tr = fmtMoney(config.taxRate);
  const trHalf = fmtMoney(config.taxRate / 2);
  const setup = fmtMoney(config.cleanTechCost);

  if (regime === 'freemarket' || regime === 'cac') {
    return `
      <details class="facilitator-notes calc-breakdown">
        <summary>How profit is calculated</summary>
        <div class="fn-body">
          <p><strong>Per unit:</strong> revenue ${rev} &minus; cost ${cost} = profit ${pp}.</p>
          <p><strong>Round profit:</strong> ${pp} &times; (units produced).</p>
          ${regime === 'cac' ? `<p><strong>Cap:</strong> you cannot produce more than ${fmt(config.cacCap)} units per round.</p>` : ''}
        </div>
      </details>`;
  }

  if (regime === 'tax') {
    return `
      <details class="facilitator-notes calc-breakdown">
        <summary>How profit is calculated (carbon tax)</summary>
        <div class="fn-body">
          <p><strong>Standard firm:</strong> tax per unit = ${tr}. Profit per unit = ${pp} &minus; ${tr} = ${fmtMoney(config.profitPerUnit - config.taxRate)}. No clean-tech setup fee.</p>
          <p><strong>Clean-tech firm:</strong> tax per unit = ${trHalf} (half emissions). Profit per unit before setup = ${fmtMoney(config.profitPerUnit - config.taxRate / 2)}. You also pay <strong>${setup}</strong> clean-tech setup <em>each round</em> you produce.</p>
          <p><strong>Round profit:</strong> (profit per unit &times; units) &minus; tax on those units &minus; setup (if clean tech and producing).</p>
        </div>
      </details>`;
  }

  if (regime === 'trade' || regime === 'trademarket') {
    return `
      <details class="facilitator-notes calc-breakdown">
        <summary>How profit is calculated (permits)</summary>
        <div class="fn-body">
          <p><strong>Per unit:</strong> revenue ${rev} &minus; cost ${cost} = operating profit ${pp} per thingamabob (before permit constraint).</p>
          <p><strong>Permits:</strong> standard firms produce up to <strong>1,000</strong> units per permit; clean-tech firms up to <strong>2,000</strong> units per permit. You cannot produce more than your remaining permit capacity.</p>
          <p><strong>Clean-tech setup:</strong> if you have clean tech and produce in a round, you pay <strong>${setup}</strong> that round.</p>
          ${regime === 'trademarket' ? '<p><strong>Trading:</strong> buying or selling permits moves cash between firms; those transfers are part of each firm\'s profit total.</p>' : ''}
        </div>
      </details>`;
  }

  return '';
}

function renderCalculator(regime, fd, config) {
  const capLine = `<div class="calc-capital-line" style="font-size:0.85rem;font-weight:600;margin-bottom:0.5rem;">Available capital: ${fmtMoney(fd.capital)}</div>`;
  const simToggle = renderCleanTechSimToggle(regime, fd);
  const breakdown = renderProfitBreakdown(regime, config, fd);

  if (regime === 'freemarket' || regime === 'cac') {
    return `
      <div class="calculator-box">
        <h3>Profit Calculator</h3>
        ${capLine}
        <label>Planned production:</label>
        <input type="number" id="calcInput" min="0" value="0" oninput="window.playApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
        ${breakdown}
      </div>`;
  }

  if (regime === 'tax') {
    const sim = calcSimCleanTech;
    const effectiveRate = sim ? config.taxRate / 2 : config.taxRate;
    const profitPerUnit = config.profitPerUnit - effectiveRate;
    const setupPerRound = sim ? config.cleanTechCost : 0;

    return `
      <div class="calculator-box">
        <h3>Profit Calculator (after tax)</h3>
        ${capLine}
        ${simToggle}
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">
          Tax/unit: ${fmtMoney(effectiveRate)} | Profit/unit: ${fmtMoney(profitPerUnit)}
          ${sim ? ` | Setup: ${fmtMoney(setupPerRound)}/round` : ''}
        </div>
        <label>Planned production:</label>
        <input type="number" id="calcInput" min="0" value="0" oninput="window.playApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
        ${breakdown}
      </div>`;
  }

  if (regime === 'trade' || regime === 'trademarket') {
    const sim = calcSimCleanTech;
    const setupPerRound = sim ? config.cleanTechCost : 0;
    const upp = sim ? 2000 : 1000;

    let tradeCalc = '';
    if (regime === 'trademarket') {
      tradeCalc = `
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #d4e6f1;">
          <h3 style="font-size:0.88rem;">Trade Calculator</h3>
          <label>Price per permit ($):</label>
          <input type="number" id="tradeCalcPrice" min="0" value="0" oninput="window.playApp.updateTradeCalc()" style="width:100%;margin-bottom:0.4rem;">
          <div class="calculator-result" id="tradeCalcResult">Enter a price above</div>
        </div>`;
    }

    return `
      <div class="calculator-box">
        <h3>Production Calculator</h3>
        ${capLine}
        ${simToggle}
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">
          Units/permit: ${fmt(upp)} | Profit/unit: ${fmtMoney(config.profitPerUnit)}
          ${sim ? ` | Setup: ${fmtMoney(setupPerRound)}/round` : ''}
        </div>
        <label>Planned production:</label>
        <input type="number" id="calcInput" min="0" value="0" oninput="window.playApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
        ${tradeCalc}
        ${breakdown}
      </div>`;
  }

  return '';
}

/* ── Debrief proposal prompt ── */

function renderDebriefPrompt(regime, d) {
  if (!d.debriefActive) {
    return `
      <div class="card" style="text-align:center;color:var(--text-secondary);">
        <p>Regime complete. Waiting for the facilitator to begin the debrief…</p>
      </div>`;
  }

  const prompt = debriefPrompt(regime);
  const alreadyProposed = hasProposed[regime];

  if (alreadyProposed) {
    return `
      <div class="debrief-student-card" style="border-color:var(--success);">
        <h3 style="color:var(--success);">Proposal submitted!</h3>
        <p style="font-size:0.88rem;color:var(--text-secondary);">
          Waiting for the facilitator to reveal the next approach…
        </p>
      </div>`;
  }

  return `
    <div class="debrief-student-card">
      <h3>What would you change?</h3>
      <p style="font-size:0.88rem;margin-bottom:0.6rem;">${prompt.question}</p>
      ${prompt.hint ? `<p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.8rem;font-style:italic;">${prompt.hint}</p>` : ''}
      <textarea id="proposalText" rows="4" placeholder="Discuss with your team, then type your proposal here…"
                style="width:100%;resize:vertical;"></textarea>
      <button class="btn btn-success mt-1" onclick="window.playApp.submitProposal('${regime}')">
        Submit Proposal
      </button>
    </div>`;
}

/* ── Firm summary at end of regime ── */

function renderFirmSummary(regime, d, fd) {
  const ppmCtx = ppmContext(d.ppm);
  const config = state.config;
  let extraRows = '';
  if (regime === 'tax') {
    const taxPaid = totalTaxPaidByFirm(d, FIRM_ID, config);
    extraRows += `<div class="stat-row"><span class="stat-label">Total carbon tax paid</span><span class="stat-value">${fmtMoney(taxPaid)}</span></div>`;
  }
  if (regime === 'trade' || regime === 'trademarket') {
    const unused = permitsRemaining(fd);
    extraRows += `<div class="stat-row"><span class="stat-label">Unused permits at end</span><span class="stat-value">${fmt(unused)}</span></div>`;
  }
  return `
    <div class="card" style="border-color:${firmColor(FIRM_ID)};">
      <h3>Your Results: ${REGIME_LABELS[regime]}</h3>
      <div class="stat-row"><span class="stat-label">Total produced</span><span class="stat-value">${fmt(fd.totalProduced)}</span></div>
      <div class="stat-row"><span class="stat-label">Total profit</span><span class="stat-value">${fmtMoney(fd.totalProfit)}</span></div>
      <div class="stat-row"><span class="stat-label">Final capital</span><span class="stat-value">${fmtMoney(fd.capital)}</span></div>
      ${extraRows}
      <div class="stat-row"><span class="stat-label">Catastrophe?</span><span class="stat-value">${d.catastrophe ? '\ud83d\udca5 YES' : '\u2705 No'}</span></div>
    </div>
    <div class="ppm-context-box" style="border-color:${ppmCtx.colour};">
      <div class="ppm-context-level" style="color:${ppmCtx.colour};">${ppmCtx.level}</div>
      <p>${ppmCtx.description}</p>
      <div class="ppm-context-source">Source: IPCC AR6 Synthesis Report (2023)</div>
    </div>`;
}

/* ── Student's own production history ── */

function renderMyHistory(d) {
  const rows = d.rounds.map((r, ri) => `
    <tr>
      <td>R${ri + 1}</td>
      <td class="num">${fmt(r.production[FIRM_ID])}</td>
      <td class="num">${fmt(r.totalProduction)}</td>
      <td class="num">${fmt(r.ppmAfter)}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <h3>Round History</h3>
      <table>
        <thead><tr><th></th><th class="num">Your prod.</th><th class="num">Industry total</th><th class="num">CO\u2082</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ── Results view ── */

function renderResults() {
  const completed = (state.completedRegimes || []).filter(r => REGIMES.includes(r));
  if (completed.length === 0) return '<div class="card"><h2>Results</h2><p>No regimes completed yet.</p></div>';

  const fd = completed.map(r => state.regimeData[r].firms[FIRM_ID]);
  const rows = completed.map((r, ri) => `
    <tr>
      <td><strong>${REGIME_LABELS[r]}</strong></td>
      <td class="num">${fmt(fd[ri].totalProduced)}</td>
      <td class="num">${fmtMoney(fd[ri].totalProfit)}</td>
      <td class="num">${fmtMoney(fd[ri].capital)}</td>
      <td class="num">${state.regimeData[r].catastrophe ? '\ud83d\udca5' : '\u2705'}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <h2>Your Results: ${state.firms[FIRM_ID].name}</h2>
      <table>
        <thead><tr><th>Regime</th><th class="num">Produced</th><th class="num">Profit</th><th class="num">Capital</th><th class="num">Safe?</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="card">
      <h3>Comparison Table</h3>
      <p style="font-size:0.85rem;color:var(--text-secondary);">
        Discuss with your team and fill in the projected comparison table.
      </p>
      <table style="font-size:0.82rem;">
        <thead><tr><th></th>${completed.map(r => `<th>${REGIME_LABELS[r]}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><td><strong>Material viability</strong></td>${completed.map(() => '<td></td>').join('')}</tr>
          <tr><td><strong>Normative desirability</strong></td>${completed.map(() => '<td></td>').join('')}</tr>
          <tr><td><strong>Political feasibility</strong></td>${completed.map(() => '<td></td>').join('')}</tr>
        </tbody>
      </table>
    </div>`;
}

/* ── Interactive calculator logic ── */

window.playApp = {
  setCalcSimCleanTech(val) {
    calcSimCleanTech = !!val;
    if (!state || !REGIMES.includes(state.regime)) return;
    render();
    const regime = state.regime;
    const inp = document.getElementById('calcInput');
    if (inp && inp.value) window.playApp.updateCalc(regime);
    if (regime === 'trademarket') {
      const tcp = document.getElementById('tradeCalcPrice');
      if (tcp && tcp.value) window.playApp.updateTradeCalc();
    }
  },

  updateCalc(regime) {
    const input = document.getElementById('calcInput');
    const result = document.getElementById('calcResult');
    if (!input || !result || !state) return;
    const qty = parseInt(input.value) || 0;
    const config = state.config;
    const fd = state.regimeData[regime].firms[FIRM_ID];
    const simClean = regimeUsesCleanTech(regime) && calcSimCleanTech;

    if (qty <= 0) { result.textContent = 'Enter a number above'; return; }

    const cost = qty * config.costPerUnit;
    const revenue = qty * config.revenuePerUnit;
    let tax = 0, setup = 0;

    if (regimeUsesTax(regime)) {
      const rate = simClean ? config.taxRate / 2 : config.taxRate;
      tax = qty * rate;
    }
    if (simClean) {
      setup = config.cleanTechCost;
    }

    const profit = revenue - cost - tax - setup;
    const ppmAdded = (qty / 1000) * (simClean ? config.ppmPer1000 / 2 : config.ppmPer1000);

    result.innerHTML = `
      Profit: <strong>${fmtMoney(profit)}</strong> &nbsp;|&nbsp;
      CO\u2082: +${fmt(ppmAdded)} ppm
      ${tax > 0 ? `&nbsp;|&nbsp; Tax: ${fmtMoney(tax)}` : ''}
      ${setup > 0 ? `&nbsp;|&nbsp; Setup: ${fmtMoney(setup)}` : ''}
    `;
  },

  updateTradeCalc() {
    const input = document.getElementById('tradeCalcPrice');
    const result = document.getElementById('tradeCalcResult');
    if (!input || !result || !state) return;
    const price = parseFloat(input.value) || 0;
    const regime = state.regime;
    const config = state.config;
    const simClean = calcSimCleanTech;
    const upp = simClean ? 2000 : 1000;
    const setup = simClean ? config.cleanTechCost : 0;
    const permitValue = (upp * config.profitPerUnit) - setup;

    if (price <= 0) { result.textContent = 'Enter a price above'; return; }

    const gainFromSelling = price - permitValue;
    const gainFromBuying = permitValue - price;

    result.innerHTML = `
      Permit value to you: <strong>${fmtMoney(permitValue)}</strong><br>
      If you <strong>sell</strong> at ${fmtMoney(price)}: ${gainFromSelling >= 0 ? 'gain' : 'loss'} of <strong>${fmtMoney(Math.abs(gainFromSelling))}</strong><br>
      If you <strong>buy</strong> at ${fmtMoney(price)}: ${gainFromBuying >= 0 ? 'gain' : 'loss'} of <strong>${fmtMoney(Math.abs(gainFromBuying))}</strong>
    `;
  },

  async submitProposal(regime) {
    const textarea = document.getElementById('proposalText');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) { alert('Please enter your proposal before submitting.'); return; }

    try {
      await submitProposal(ROOM, regime, FIRM_ID, text);
      hasProposed[regime] = true;
      render();
    } catch (e) {
      console.error('[STUDENT] submitProposal failed', e);
      alert('Could not submit proposal. Check your connection.\n\n' + e.message);
    }
  },

  async submitProd(regime, round, maxAllowed) {
    const input = document.getElementById('studentProd');
    if (!input || !state) return;
    const raw = Math.max(0, parseInt(input.value, 10) || 0);
    let qty = raw;
    if (qty > maxAllowed) qty = maxAllowed;
    const fd = state.regimeData[regime].firms[FIRM_ID];
    const roundKey = `${regime}_${round}`;
    const note = buildClampMessage(regime, fd, state.config, raw, qty);
    if (note) submissionClampNotes[roundKey] = note;
    else delete submissionClampNotes[roundKey];

    console.log(`[STUDENT] submitProd: writing to ${regime}_${round}/${FIRM_ID}, qty=${qty}`);
    try {
      await submitDecision(ROOM, regime, round, FIRM_ID, qty);
      console.log(`[STUDENT] submitProd: write succeeded`);
      hasSubmitted[roundKey] = qty;
      render();
    } catch (e) {
      console.error(`[STUDENT] submitProd: write FAILED`, e);
      alert('Could not submit. Check your connection.\n\n' + e.message);
    }
  },
};

/* ── Bootstrap ── */

init();
