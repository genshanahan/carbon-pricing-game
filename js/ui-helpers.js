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
  const barColor = danger ? '#e74c3c' : pct > 75 ? '#e67e22' : pct > 50 ? '#f1c40f' : '#2ecc71';
  return `
    <div class="co2-meter ${danger ? 'danger' : ''}">
      <div class="ppm-value">${fmt(ppm)} ppm</div>
      <div class="ppm-label">CO\u2082 Concentration ${danger ? '\u2014 CATASTROPHE TRIGGERED' : ''}</div>
      <div class="co2-bar"><div class="co2-bar-fill" style="width:${pct}%;background:${barColor};"></div></div>
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

export function regimeDescription(regime, config) {
  const descriptions = {
    freemarket: `No regulation. Firms compete to maximise profit. Catastrophe at ${config.triggerPpm} ppm.`,
    cac: `Hard cap: no firm may produce more than <strong>${fmt(config.cacCap)}</strong> thingamabobs per round.`,
    tax: `No cap. Tax is based on <strong>emissions</strong>: standard firms pay <strong>${fmtMoney(config.taxRate)}</strong> per unit (profit: ${fmtMoney(config.profitPerUnit - config.taxRate)}/unit). Clean-tech firms halve their emissions and pay <strong>${fmtMoney(config.taxRate / 2)}</strong> per unit (profit: ${fmtMoney(config.profitPerUnit - config.taxRate / 2)}/unit, minus ${fmtMoney(config.cleanTechCost)} setup/round).`,
    trade: `No tax. Hard cap on CO\u2082 emissions via permits (1 permit = ${config.ppmPer1000} ppm CO\u2082). Standard firms: 1 permit = 1,000 units. Clean-tech firms: 1 permit = 2,000 units.`,
    trademarket: `Same permit rules as Cap, but firms may now <strong>buy and sell permits</strong>. The permit market logs each agreed trade: seller, buyer, permits, and price.`,
  };
  return descriptions[regime] || '';
}
