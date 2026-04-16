/**
 * Shared UI helpers — formatting, CO₂ meter, common HTML fragments.
 * No DOM manipulation; returns HTML strings for rendering.
 */

export function fmt(n) {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
}

export function fmtMoney(n) {
  if (Math.abs(n) < 1 && n !== 0) return '$' + n.toFixed(2);
  return '$' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

export function renderCO2Meter(ppm, config, extra) {
  const pct = Math.min(((ppm - config.startPpm) / (config.triggerPpm - config.startPpm)) * 100, 100);
  const danger = ppm >= config.triggerPpm;
  let fillClass = 'co2-bar-fill--low';
  if (danger) fillClass = 'co2-bar-fill--danger';
  else if (pct > 75) fillClass = 'co2-bar-fill--high';
  else if (pct > 50) fillClass = 'co2-bar-fill--mid';
  return `
    <div class="co2-meter ${danger ? 'danger' : ''}">
      <div class="ppm-value">${fmt(ppm)} ppm</div>
      <div class="ppm-label">CO\u2082 concentration ${danger ? '\u2014 catastrophe threshold reached' : ''}</div>
      <div class="co2-bar" role="progressbar" aria-valuemin="${config.startPpm}" aria-valuemax="${config.triggerPpm}" aria-valuenow="${Math.round(ppm)}" aria-label="CO2 concentration progress toward catastrophe threshold">
        <div class="co2-bar-fill ${fillClass}" style="width:${pct}%;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-secondary);">
        <span>${config.startPpm} ppm (start)</span><span>${config.triggerPpm} ppm (trigger)</span>
      </div>
      ${extra || ''}
    </div>`;
}

export function firmColor(i) { return `var(--firm${i})`; }
export function firmBg(i) { return `var(--firm${i}-bg)`; }

export function cleanBadge(fd) {
  if (fd.cleanTech) return '<span class="clean-badge">CLEAN</span>';
  return '<span class="dirty-badge">STANDARD</span>';
}

export function regimeUsesCleanTech(regime) {
  return ['tax', 'trade', 'trademarket'].includes(regime);
}

export function regimeUsesTax(regime) { return regime === 'tax'; }

export function regimeUsesPermits(regime) {
  return regime === 'trade' || regime === 'trademarket';
}

export function regimeHasCap(regime) { return regime === 'cac'; }

export function regimeHasPermitMarket(regime) { return regime === 'trademarket'; }

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function qrCodeUrl(text, size = 250) {
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(text)}&size=${size}x${size}`;
}

export function ppmContext(ppm) {
  if (ppm < 400) {
    return {
      level: 'Pre-industrial range',
      description: `At ${fmt(ppm)} ppm, CO₂ concentration remains below 400 ppm — roughly where the real world was before 2015. Warming stays below +1°C above pre-industrial levels. Ecosystems are relatively stable.`,
      colour: '#27ae60',
    };
  }
  if (ppm < 430) {
    return {
      level: 'Current real-world level',
      description: `At ${fmt(ppm)} ppm, this is close to the real world today (~425 ppm in 2025). Warming is approximately +1.1–1.2°C above pre-industrial levels. Effects include more frequent heatwaves, intensifying storms, and coral bleaching events.`,
      colour: '#f1c40f',
    };
  }
  if (ppm < 450) {
    return {
      level: 'Approaching 1.5°C threshold',
      description: `At ${fmt(ppm)} ppm, warming is approaching +1.5°C — the aspirational limit of the Paris Agreement. At this level, extreme weather events become significantly more common, small island nations face existential flooding risk, and crop yields begin to decline in tropical regions.`,
      colour: '#e67e22',
    };
  }
  if (ppm < 500) {
    return {
      level: 'Beyond 1.5°C — heading towards 2°C',
      description: `At ${fmt(ppm)} ppm, warming is approximately +1.5–2°C. This exceeds the Paris Agreement's safer limit. Severe coral bleaching threatens 99% of reefs, Arctic summer sea ice disappears regularly, and ice sheet instability accelerates sea-level rise measurably.`,
      colour: '#e67e22',
    };
  }
  return {
    level: 'Catastrophic warming territory',
    description: `At ${fmt(ppm)} ppm, warming exceeds +2°C and may approach +3°C or higher. This means mass displacement from coastal flooding, collapse of major agricultural systems, irreversible ice sheet loss, and severe biodiversity extinction. The IPCC AR6 describes this as "very high risk" across all assessed sectors.`,
    colour: '#e74c3c',
  };
}

export function dwlAnalogy(dwl, totalProfit) {
  if (dwl <= 0) return null;
  const pct = totalProfit > 0 ? ((dwl / (totalProfit + dwl)) * 100).toFixed(1) : null;
  let analogy = `The ${fmtMoney(dwl)} figure is the gap between this regime's output and what the free-market regime produced &mdash; bearing in mind that the free-market output came at the cost of breaching the safe climate threshold, so it is not a benchmark society could actually sustain. The economic interpretation is that the same regulatory goal could in principle have been met more efficiently &mdash; e.g. by allocating production toward firms that turn each unit of pollution into more useful output. Read through a fair-consumption-space lens (the level of material provisioning society can sustain within a 1.5&nbsp;&deg;C carbon budget), this inefficiency matters insofar as it cuts into the goods and services people rely on for a decent standard of living, rather than because it foregoes economic growth per se.`;
  if (pct !== null) {
    analogy += ` In scale terms, it is roughly equivalent to ${pct}% of what the industry actually produced this regime.`;
  }
  return analogy;
}

export function debriefPrompt(regime) {
  const prompts = {
    freemarket: {
      question: 'The free market led to unchecked emissions. What rule change would you propose to prevent catastrophe while still allowing firms to operate profitably?',
      hint: '',
    },
    cac: {
      question: 'Command & control capped each firm equally. What problems did you notice? What would you change?',
      hint: '',
    },
    tax: {
      question: 'The carbon tax put a price on pollution but didn\'t guarantee a specific emissions level. What would you change to get more certainty about total emissions?',
      hint: '',
    },
    trade: {
      question: 'The permit cap controlled total emissions but some firms were stuck with permits they didn\'t need, while others wanted more. What would you change?',
      hint: '',
    },
    trademarket: {
      question: 'Cap & Trade combined a hard limit on emissions with a market for permits. What are the strengths and weaknesses of this approach? Could you improve it further?',
      hint: 'Consider: did the market price of permits reflect the true social cost of pollution? What happens if permits are allocated unfairly, or if firms can lobby to increase the cap?',
    },
  };
  return prompts[regime] || { question: 'What would you change about this regime?', hint: '' };
}

export function facilitatorNotes(regime) {
  const notes = {
    freemarket: {
      timing: '10–15 minutes (5 rounds + discussion)',
      keyPoints: [
        'This is the baseline — no regulation at all. Let students discover the tragedy of the commons organically.',
        'Every firm has an incentive to produce at maximum capacity. Total pollution will almost certainly trigger catastrophe.',
        'Resist the urge to intervene or hint. The point is for students to feel the collective action problem firsthand.',
      ],
      expectedDynamics: [
        'Most firms will produce at or near maximum capacity in every round.',
        'Some students may attempt informal agreements to limit production — note this but don\'t encourage or discourage it.',
        'Catastrophe typically triggers by Round 3–4. If it doesn\'t, the class is unusually cooperative (discuss why).',
      ],
      debriefTips: [
        'Ask: "Why did everyone produce so much?" Draw out the rational individual incentive.',
        'Ask: "Did anyone try to cooperate? What happened?" This surfaces the free-rider problem.',
        'Key insight: rational individual behaviour leads to collectively irrational outcomes.',
      ],
    },
    cac: {
      timing: '10 minutes (5 rounds + discussion)',
      keyPoints: [
        'The cap is uniform — every firm faces the same production limit regardless of efficiency.',
        'This is the simplest form of regulation. It guarantees quantity certainty but at the cost of economic efficiency.',
        'Students will notice they can\'t exceed the cap even if they have capital to spare.',
      ],
      expectedDynamics: [
        'Production will be uniform across all firms (all at the cap).',
        'Total profit will be lower than the free market, but catastrophe may be avoided.',
        'Some students may complain about the inflexibility — this is pedagogically valuable.',
      ],
      debriefTips: [
        'Ask: "Was it fair that every firm had the same cap?" Some firms might have reduced pollution more cheaply.',
        'Ask: "What was the deadweight loss? What does it represent?" (The mechanical figure compares to free-market output, but free-market output overshoots the safe climate threshold. Read it instead as: in principle, the same regulatory goal could have been met more efficiently — by allocating production to firms that turn each unit of pollution into more useful output. The lens that matters is the fair consumption space at 1.5 °C, not foregone growth.)',
        'Foreshadow: "What if instead of a hard cap, firms paid a price per unit of pollution?"',
      ],
    },
    tax: {
      timing: '12–15 minutes (5 rounds + clean-tech assignment + discussion)',
      keyPoints: [
        'The tax is emissions-based: firms with clean technology pay half the rate per unit.',
        'This introduces price certainty but quantity uncertainty — total emissions depend on how firms respond.',
        'The tax revenue goes to the government (not redistributed to firms in this simulation).',
        'Clean-tech firms face a trade-off: lower tax per unit vs. a one-off sunk investment deducted from their capital before Round 1. Because that cash is no longer available for production, clean-tech firms start smaller and earn less in the early rounds.',
      ],
      expectedDynamics: [
        'Clean-tech firms will earn less in rounds 1–3 because the sunk investment leaves them capital-constrained. This is deliberate — ask students whether this feels fair.',
        'By round 4 the compounding tax saving pulls clean-tech firms ahead of standard firms on cumulative profit.',
        'Total emissions may still exceed the trigger — the tax rate may be too low.',
        'Students begin to see the efficiency argument: cleaner production requires an upfront investment, and a carbon tax gives firms a reason to make it.',
      ],
      debriefTips: [
        'Ask: "Was it fair that clean-tech firms earned less in the early rounds? Should governments subsidise the transition?"',
        'Ask: "Did the tax reduce emissions enough? What would happen if we raised it?"',
        'Ask: "Who bore the cost of the tax? Was that fair?"',
        'Key insight: a tax gives price certainty but not quantity certainty. Bridge to: "What if we set a hard limit on total emissions instead?"',
      ],
    },
    trade: {
      timing: '10 minutes (5 rounds + permit allocation + discussion)',
      keyPoints: [
        'Permits cap total emissions with certainty. Each permit allows a fixed amount of CO₂.',
        'Without trading, firms with excess permits can\'t use them productively, and firms that need more can\'t get them.',
        'This sets up the motivation for Cap & Trade in the next regime.',
      ],
      expectedDynamics: [
        'Firms with clean technology get more effective production per permit (2,000 units vs. 1,000).',
        'Some firms will be permit-constrained and unable to produce as much as they could afford.',
        'Total emissions should stay within the cap — but economic output is suboptimal.',
      ],
      debriefTips: [
        'Ask: "Did anyone have permits they didn\'t use? Did anyone want more?"',
        'Ask: "What if you could sell your spare permits to someone who values them more?"',
        'This should naturally lead students to propose trading — the key pedagogical moment.',
      ],
    },
    trademarket: {
      timing: '15–20 minutes (5 rounds + permit allocation + trading rounds + discussion)',
      keyPoints: [
        'This is the culmination: a hard emissions cap plus a market mechanism for efficient allocation.',
        'Firms that take the clean-tech investment at the start of this regime will abate (their permits cover 2,000 units of output instead of 1,000), but the sunk cost leaves them capital-constrained — so they typically end up holding slack permits they cannot profitably use.',
        'Firms that stay standard will keep more capital on hand and can still turn each permit into $1,000 of gross profit. They are the natural buyers in the permit market.',
        'Record trades carefully — the market price data is valuable for the final discussion.',
        'Let students negotiate freely. Don\'t set a price — the market should discover it.',
      ],
      expectedDynamics: [
        'By the later rounds, clean-tech firms tend to be capital-constrained with slack permits (willing to sell at any positive price), while standard firms tend to be permit-constrained (willing to buy up to their gross permit value).',
        'The equilibrium price settles between those two anchors — above the sellers\' reservation (effectively $0) and below the buyers\' cap (the gross $1,000/permit value).',
        'Total emissions stay within the cap, but economic output is higher than under Cap alone because permits end up with the firms that can convert them into production.',
        'Some students may attempt price manipulation or collusion — note this for the political feasibility discussion.',
      ],
      debriefTips: [
        'Ask: "What was the market price of a permit? Does it reflect the true social cost of pollution?"',
        'Ask: "Did trading make both sides better off? How?"',
        'Ask: "What happens if firms lobby to increase the total number of permits?"',
        'Key insight: Cap & Trade combines quantity certainty with economic efficiency, but is vulnerable to political capture.',
      ],
    },
  };
  return notes[regime] || null;
}

export function onboardingGuide() {
  return `
    <details class="facilitator-notes" open>
      <summary>How to run this game</summary>
      <div class="fn-body">
        <p><strong>Overview:</strong> Students play as competing firms that manufacture "thingamabobs". Each round, firms choose how many to produce. Production generates profit but also CO₂ emissions. If total emissions exceed the threshold, a climate catastrophe is triggered.</p>
        <p><strong>Flow:</strong> The game runs through five regulatory regimes in sequence. After each regime, a structured debrief invites students to propose what they would change — then the next regime reveals the real-world answer.</p>
        <ol>
          <li><strong>Free Market</strong> — No rules. Students discover the tragedy of the commons.</li>
          <li><strong>Command &amp; Control</strong> — A hard per-firm production cap. Effective but blunt.</li>
          <li><strong>Carbon Tax</strong> — Price-based regulation. Efficient but uncertain quantity.</li>
          <li><strong>Cap</strong> — Permit-based quantity cap. Certain quantity but inflexible.</li>
          <li><strong>Cap &amp; Trade</strong> — Permits plus a market. The policy synthesis.</li>
        </ol>
        <p><strong>Student devices:</strong> Students join via the QR code or room link on their phones. They see regime rules, a profit calculator, and a submission form. All production decisions are submitted digitally.</p>
        <p><strong>Timing:</strong> Allow 60–90 minutes for the full game (all five regimes). Each regime takes 10–20 minutes including discussion. You can stop after any regime if time is short.</p>
        <p><strong>Key tip:</strong> Resist explaining the next regime before the debrief. The structured proposal step is most powerful when students genuinely don't know what's coming next.</p>
      </div>
    </details>`;
}

export function regimeDescription(regime, config) {
  const descriptions = {
    freemarket: `No regulation. Firms compete to maximise profit. Catastrophe at ${config.triggerPpm} ppm.`,
    cac: `Hard cap: no firm may produce more than <strong>${fmt(config.cacCap)}</strong> thingamabobs per round.`,
    tax: `No cap. Tax is based on <strong>emissions</strong>: standard firms pay <strong>${fmtMoney(config.taxRate)}</strong> per unit (profit: ${fmtMoney(config.profitPerUnit - config.taxRate)}/unit). Clean-tech firms halve their emissions and pay <strong>${fmtMoney(config.taxRate / 2)}</strong> per unit (profit: ${fmtMoney(config.profitPerUnit - config.taxRate / 2)}/unit, after a one-off ${fmtMoney(config.cleanTechCost)} clean-tech investment).`,
    trade: `No tax. Hard cap on CO\u2082 emissions via permits (1 permit = ${config.ppmPer1000} ppm CO\u2082). Standard firms: 1 permit = 1,000 units. Clean-tech firms: 1 permit = 2,000 units.`,
    trademarket: `Same permit rules as Cap, but firms may now <strong>buy and sell permits</strong>. The permit market logs each agreed trade: seller, buyer, permits, and price.`,
  };
  return descriptions[regime] || '';
}
