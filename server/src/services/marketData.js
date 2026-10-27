import MarketRow from '../models/MarketRow.js';
import { CONFIG, CONTRACTS, OZ_GRAMS } from '../../config.js';

const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

export async function seedSyntheticData() {
  if (await MarketRow.estimatedDocumentCount()) return;
  const rng = (seed => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; })(7);
  const end = new Date();
  while ([0, 6].includes(end.getDay())) end.setDate(end.getDate() - 1);
  const sessions = [];
  for (let i = 0; i < 60; i++) {
    const d = addDays(end, -i);
    if (![0, 6].includes(d.getDay())) sessions.push(d);
  }
  sessions.reverse();
  const expiries = [];
  let y = end.getFullYear(), m = end.getMonth() + 1;
  for (let i = 0; i < 3; i++) {
    m++; if (m > 12) { m = 1; y++; }
    expiries.push(`${y}-${String(m).padStart(2,'0')}-05`);
  }
  let comex = 395000, fx = 88;
  const docs = [];
  for (const d of sessions) {
    comex *= 1 + ((rng() + rng() + rng() + rng() - 2) * 0.008);
    fx *= 1 + ((rng() + rng() + rng() + rng() - 2) * 0.002);
    const cents = Math.round(comex), fxE4 = Math.round(fx * 1e4);
    const date = iso(d);
    for (const [symbol, spec] of Object.entries(CONTRACTS)) {
      for (let ei = 0; ei < expiries.length; ei++) {
        const expiry = expiries[ei];
        const days = Math.round((new Date(expiry) - d) / 86400000);
        const fair = cents / 100 * fxE4 / 1e4 / OZ_GRAMS * (1 + CONFIG.dutyPct);
        let pg = fair * (1 + CONFIG.carryPct * days / 365) * (1 + spec.premium) *
          (1 + ((rng() + rng() + rng() + rng() - 2) * 0.0006));
        if (date === iso(sessions[sessions.length - 1]) && symbol === 'GOLDPETAL' && ei === 0) pg *= 1.012;
        const volume = Math.floor((200 + rng() * 4800) / (10 ** ei));
        docs.push({ date, symbol, expiry, settlePaise: Math.round(pg * spec.quoteGrams * 100),
          volume, comexCentsPerOz: cents, usdinrE4: fxE4, source: 'synthetic' });
      }
    }
  }
  await MarketRow.insertMany(docs, { ordered: false });
}

function mean(values) { return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null; }
function std(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  return Math.sqrt(values.reduce((s,x)=>s+(x-m)**2,0)/(values.length-1));
}
function zScore(history, value, window) {
  const prior = history.slice(-window);
  if (prior.length < 10) return null;
  const sd = std(prior);
  return !sd ? null : (value - mean(prior))/sd;
}

function calculateCost(pg, lotGrams, broker) {
  const legTurnover = pg * lotGrams;
  const buyFees = broker.flat_brokerage_per_order + (legTurnover * broker.pct_brokerage / 100) + broker.exchange_charge_per_order + (legTurnover * broker.exchange_charge_pct / 100);
  const sellFees = broker.flat_brokerage_per_order + (legTurnover * broker.pct_brokerage / 100) + broker.exchange_charge_per_order + (legTurnover * broker.exchange_charge_pct / 100) + (legTurnover * broker.sell_side_tax_pct / 100);
  const fees = buyFees + sellFees;
  const gst = fees * (broker.gst_on_fees_pct / 100);
  const totalCost = fees + gst;
  const costPerGram = totalCost / lotGrams;
  const costPct = (totalCost / legTurnover) * 100;
  return { totalCost, costPerGram, costPct };
}

function calculateExitGuard(sessionDateStr, expiryStr, exitGuardCfg) {
  const sessionDate = new Date(sessionDateStr);
  const expiryDate = new Date(expiryStr);
  let tradingDaysToExpiry = 0;
  let curr = new Date(sessionDate);
  while (curr < expiryDate) {
    curr.setDate(curr.getDate() + 1);
    if (curr.getDay() !== 0 && curr.getDay() !== 6) {
      tradingDaysToExpiry++;
    }
  }
  const tenderTradingDays = exitGuardCfg.tender_period_trading_days;
  const daysToExit = tradingDaysToExpiry - tenderTradingDays;
  let status = 'ACTIVE';
  if (tradingDaysToExpiry <= 0) status = 'EXPIRED';
  else if (daysToExit === 0) status = 'ACT TODAY BY ' + exitGuardCfg.square_off_time;
  else if (daysToExit < 0) status = 'TENDER OPEN / PAST SAFE EXIT';
  else if (daysToExit <= exitGuardCfg.warn_days) status = 'EXIT SOON';
  return { tradingDaysToExpiry, daysToExit, status };
}

function label(row, cfg) {
  const tags = [], why = [];
  if (row.basisPct > cfg.richPct) { tags.push('RICH'); why.push(`${row.basisPct >= 0 ? '+' : ''}${row.basisPct.toFixed(2)}% vs fair`); }
  else if (row.basisPct < -cfg.cheapPct) { tags.push('CHEAP'); why.push(`${row.basisPct.toFixed(2)}% vs fair`); }
  
  const spec = CONTRACTS[row.symbol] || { lotGrams: 100, quoteGrams: 10 };
  const costInfo = calculateCost(row.pg, spec.lotGrams, cfg.broker);
  row.costPerGram = costInfo.costPerGram;
  row.costPct = costInfo.costPct;
  const mispricingRs = Math.abs(row.pg - row.fair);
  if ((tags.includes('RICH') || tags.includes('CHEAP')) && row.costPerGram >= mispricingRs) {
    tags.push('COST>GAP');
    why.push(`cost ₹${row.costPerGram.toFixed(1)}/g >= gap ₹${mispricingRs.toFixed(1)}/g`);
  }

  const exitGuard = calculateExitGuard(row.date, row.expiry, cfg.exit_guard);
  row.exitGuard = exitGuard;
  if (exitGuard.status === 'EXIT SOON' || exitGuard.status.startsWith('ACT TODAY')) {
    tags.push('EXIT GUARD');
    why.push(exitGuard.status);
  }

  if (row.zCross != null && row.zCross > cfg.zLimit) { tags.push('WIDE'); why.push(`gap to GOLD z=${row.zCross.toFixed(1)}`); }
  else if (row.zCross != null && row.zCross < -cfg.zLimit) { tags.push('TIGHT'); why.push(`gap to GOLD z=${row.zCross.toFixed(1)}`); }
  if (row.calAnnPct != null) { tags.push(row.calAnnPct > 0 ? 'CONTANGO' : 'BACKWARDATION'); why.push(`carry ${row.calAnnPct >= 0 ? '+' : ''}${row.calAnnPct.toFixed(1)}% a year`); }
  if (row.days <= cfg.rollDays) { tags.push('ROLL'); why.push(`${row.days} days left`); }
  if (row.volume < cfg.minVolume) { tags.push('THIN'); why.push(`volume ${row.volume}`); }
  if (!tags.length) return { tags: ['OK'], why: `within ${cfg.richPct}% of fair` };
  return { tags, why: why.join('; ') };
}

function generateBrief(rows, date) {
  if (!rows.length) return `Market session ${date}: No contract observations available.`;
  const sortedByDev = [...rows].sort((a,b)=>Math.abs(b.basisPct)-Math.abs(a.basisPct));
  const worst = sortedByDev[0];
  const thinCount = rows.filter(r=>r.tags?.includes('THIN')).length;
  const costGapCount = rows.filter(r=>r.tags?.includes('COST>GAP')).length;
  const urgentExits = rows.filter(r=>r.exitGuard && ['EXIT SOON', 'ACT TODAY BY 21:00', 'TENDER OPEN / PAST SAFE EXIT'].includes(r.exitGuard.status));
  
  let brief = `Market session ${date}: ${worst.symbol} (${worst.expiry}) shows the largest deviation at ${worst.basisPct >= 0 ? '+' : ''}${worst.basisPct.toFixed(2)}% (${worst.tags.join(', ')}). `;
  brief += `Everything else across ${rows.length} contracts is within normal parameters. `;
  if (thinCount > 0) brief += `${thinCount} contract(s) flagged as thin volume. `;
  if (costGapCount > 0) brief += `${costGapCount} contract(s) have round-trip trading cost exceeding fair value gap ([COST>GAP]). `;
  if (urgentExits.length > 0) {
    brief += `Urgent exit required for ${urgentExits.map(e=>e.symbol+' '+e.expiry).join(', ')}. `;
  } else {
    brief += `No immediate tender period delivery risks. `;
  }
  return brief;
}

export async function getSessions() {
  return (await MarketRow.distinct('date')).sort();
}

export async function analyseSession(date) {
  const dates = await getSessions();
  const selected = date || dates.at(-1);
  if (!dates.includes(selected)) return { date: selected, dates, rows: null };
  const raw = await MarketRow.find({ date: { $lte: selected } }).sort({ date: 1 }).lean();
  const enriched = raw.map(r => {
    const quoteGrams = CONTRACTS[r.symbol]?.quoteGrams || 10;
    const pg = r.settlePaise / 100 / quoteGrams;
    const days = Math.round((new Date(r.expiry) - new Date(r.date)) / 86400000);
    const fairSpot = r.comexCentsPerOz / 100 * r.usdinrE4 / 1e4 / OZ_GRAMS * (1 + CONFIG.dutyPct);
    const fair = fairSpot * (1 + CONFIG.carryPct * days / 365);
    return { ...r, pg, days, fair, basisPct: (pg / fair - 1) * 100 };
  });
  const lookup = new Map(enriched.map(r => [`${r.date}|${r.symbol}|${r.expiry}`, r]));
  for (const r of enriched) {
    const gold = lookup.get(`${r.date}|GOLD|${r.expiry}`);
    r.goldPg = gold?.pg ?? null;
    r.cross = r.symbol === 'GOLD' || !gold ? null : r.pg - gold.pg;
    r.premiumPct = r.symbol === 'GOLD' || !gold ? null : (r.pg / gold.pg - 1) * 100;
  }
  const histories = new Map();
  for (const r of enriched) {
    const key = `${r.symbol}|${r.expiry}`;
    if (!histories.has(key)) histories.set(key, []);
    const h = histories.get(key);
    r.zBasis = zScore(h.map(x=>x.basisPct), r.basisPct, CONFIG.zWindow);
    r.zCross = r.cross == null ? null : zScore(h.filter(x=>x.cross != null).map(x=>x.cross), r.cross, CONFIG.zWindow);
    h.push(r);
  }
  const all = enriched.filter(r=>r.date===selected);
  const bySymbol = new Map();
  for (const r of all.slice().sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.expiry.localeCompare(b.expiry))) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol).push(r);
  }
  for (const list of bySymbol.values()) {
    list.forEach((r,i)=>{
      const prev = list[i-1];
      r.calAnnPct = prev && (r.days-prev.days)!==0 ? (r.pg/prev.pg-1)*365/(r.days-prev.days)*100 : null;
      Object.assign(r, label(r, CONFIG));
    });
  }
  const rows = all.sort((a,b)=>b.pg-a.pg).map(r=>({
    date:r.date, symbol:r.symbol, expiry:r.expiry, pg:Number(r.pg.toFixed(2)),
    fair:Number(r.fair.toFixed(2)), basisPct:Number(r.basisPct.toFixed(3)),
    costPerGram: Number((r.costPerGram || 0).toFixed(2)),
    costPct: Number((r.costPct || 0).toFixed(3)),
    exitGuard: r.exitGuard,
    zBasis:r.zBasis == null ? null : Number(r.zBasis.toFixed(2)),
    zCross:r.zCross == null ? null : Number(r.zCross.toFixed(2)),
    premiumPct:r.premiumPct == null ? null : Number(r.premiumPct.toFixed(3)),
    volume:r.volume, days:r.days, tags:r.tags, why:r.why, source:r.source
  }));
  const brief = generateBrief(rows, selected);
  return { date: selected, dates, rows, brief, source: all[0]?.source || 'synthetic' };
}
