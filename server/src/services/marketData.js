
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarketRow from '../models/MarketRow.js';
import { CONFIG, CONTRACTS } from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const DAY_MS = 86400000;

const CSV_FILES = [
  {
    names: ['GOLDM.csv', 'BhavCopyCommodiyWise_27102022GOLDM.csv'],
    symbol: 'GOLDM'
  },
  { names: ['GOLDGUINEA.csv'], symbol: 'GOLDGUINEA' },
  { names: ['GOLDPETAL.csv', 'GOLDPETEL.csv'], symbol: 'GOLDPETAL' },
  { names: ['GOLDTEN.csv'], symbol: 'GOLDTEN' }
];

function number(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').trim();

  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'nan') {
    return null;
  }

  const result = Number(cleaned);
  return Number.isFinite(result) ? result : null;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"' && quoted && line[i + 1] === '"') {
      value += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }

  values.push(value.trim());
  return values;
}

function parseCsv(content) {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(line => line.trim());

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);

    return Object.fromEntries(
      headers.map((header, index) => [
        header.trim(),
        values[index] ?? ''
      ])
    );
  });
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function parseDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  let match = raw.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);

  if (!match) {
    match = raw.match(/^(\d{1,2})([A-Za-z]{3})(\d{4})$/);
  }

  if (match) {
    const date = new Date(
      `${match[2]} ${match[1]}, ${match[3]} 00:00:00`
    );

    return Number.isNaN(date.getTime()) ? null : formatDate(date);
  }

  match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match) return raw;

  match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);

  if (match) {
    const date = new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1])
    );

    return Number.isNaN(date.getTime()) ? null : formatDate(date);
  }

  return null;
}

function findCsv(names) {
  for (const name of names) {
    const filePath = path.join(DATA_DIR, name);

    if (fs.existsSync(filePath)) return filePath;
  }

  return null;
}

function csvRowsForFile(filePath, symbol) {
  const contract = CONTRACTS[symbol];

  if (!contract) {
    console.warn(`Missing contract configuration for ${symbol}`);
    return [];
  }

  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const result = [];

  for (const row of rows) {
    const date = parseDate(row.Date);
    const expiry = parseDate(row['Expiry Date']);
    const close = number(row.Close);
    const volume = number(row['Volume(Lots)']);

    const csvSymbol = String(row.Symbol || symbol)
      .trim()
      .toUpperCase()
      .replace('GOLDPETEL', 'GOLDPETAL');

    const instrument = String(row['Instrument Name'] || '')
      .trim()
      .toUpperCase();

    const optionType = String(row['Option Type'] || '')
      .trim()
      .toUpperCase();

    if (csvSymbol !== symbol) continue;
    if (instrument && instrument !== 'FUTCOM') continue;

    if (optionType && optionType !== '-' && optionType !== 'XX') {
      continue;
    }

    if (
      !date ||
      !expiry ||
      close == null ||
      close <= 0 ||
      volume == null ||
      volume < 0
    ) {
      continue;
    }

    result.push({
      date,
      symbol,
      expiry,
      settlePaise: Math.round(
        close * contract.quoteGrams * 100
      ),
      volume: Math.round(volume),
      comexCentsPerOz: 0,
      usdinrE4: 0,
      source: 'csv'
    });
  }

  return result;
}

export async function importBhavcopyData() {
  const imported = [];
  const missingFiles = [];

  for (const item of CSV_FILES) {
    const filePath = findCsv(item.names);

    if (!filePath) {
      missingFiles.push(item.names.join(' or '));
      continue;
    }

    const rows = csvRowsForFile(filePath, item.symbol);

    console.log(
      `${path.basename(filePath)}: ${rows.length} valid ${item.symbol} rows`
    );

    imported.push(...rows);
  }

  if (!imported.length) {
    throw new Error(
      `No valid Bhavcopy rows found in ${DATA_DIR}. ` +
      'Check filenames, CSV headers and date formats.'
    );
  }

  await MarketRow.deleteMany({ source: 'synthetic' });

  const uniqueRows = new Map();

  for (const row of imported) {
    uniqueRows.set(
      `${row.date}|${row.symbol}|${row.expiry}`,
      row
    );
  }

  let inserted = 0;
  let updated = 0;

  for (const row of uniqueRows.values()) {
    const result = await MarketRow.updateOne(
      {
        date: row.date,
        symbol: row.symbol,
        expiry: row.expiry
      },
      { $set: row },
      { upsert: true }
    );

    inserted += result.upsertedCount || 0;
    updated += result.modifiedCount || 0;
  }

  console.log(
    `Bhavcopy import complete: ${uniqueRows.size} unique observations.`
  );
  console.log(`Inserted: ${inserted}; updated: ${updated}.`);

  if (missingFiles.length) {
    console.warn(`CSV files not found: ${missingFiles.join(', ')}`);
  }
}

export async function getSessions() {
  return (
    await MarketRow.distinct('date', { source: 'csv' })
  ).sort();
}

// Historical data for charts. Returns actual imported observations.
export async function getHistory(symbol) {
  const allowedSymbols = Object.keys(CONTRACTS);

  if (!allowedSymbols.includes(symbol)) {
    throw new Error(
      `Invalid symbol. Allowed symbols: ${allowedSymbols.join(', ')}`
    );
  }

  const contract = CONTRACTS[symbol];

  const rows = await MarketRow.find({
    symbol,
    source: 'csv'
  })
    .sort({ date: 1, expiry: 1 })
    .lean();

  return rows.map(row => ({
    date: row.date,
    symbol: row.symbol,
    expiry: row.expiry,
    price: Number(
      (row.settlePaise / 100 / contract.quoteGrams).toFixed(2)
    ),
    priceUnit: 'INR per gram',
    volume: row.volume,
    source: 'csv'
  }));
}

function mean(values) {
  if (!values.length) return null;

  return values.reduce((sum, value) => sum + value, 0) /
    values.length;
}

function standardDeviation(values) {
  if (values.length < 2) return null;

  const average = mean(values);

  return Math.sqrt(
    values.reduce(
      (sum, value) => sum + (value - average) ** 2,
      0
    ) / (values.length - 1)
  );
}

function zScore(history, value, windowSize) {
  if (value == null) return null;

  const previous = history
    .filter(item => item != null)
    .slice(-windowSize);

  if (previous.length < 10) return null;

  const deviation = standardDeviation(previous);

  if (deviation == null || deviation === 0) return null;

  return (value - mean(previous)) / deviation;
}

function calculateCost(pricePerGram, lotGrams, broker = {}) {
  const turnover = pricePerGram * lotGrams;

  const flatBrokerage = Number(broker.flat_brokerage_per_order || 0);
  const brokeragePct = Number(broker.pct_brokerage || 0);
  const exchangeFlat = Number(broker.exchange_charge_per_order || 0);
  const exchangePct = Number(broker.exchange_charge_pct || 0);
  const sellTaxPct = Number(broker.sell_side_tax_pct || 0);
  const gstPct = Number(broker.gst_on_fees_pct || 0);

  const legFees =
    flatBrokerage +
    turnover * brokeragePct / 100 +
    exchangeFlat +
    turnover * exchangePct / 100;

  const fees =
    legFees * 2 +
    turnover * sellTaxPct / 100;

  const totalCost = fees * (1 + gstPct / 100);

  return {
    costPerGram: lotGrams > 0 ? totalCost / lotGrams : 0,
    costPct: turnover > 0 ? totalCost / turnover * 100 : 0
  };
}

function calculateExitGuard(dateString, expiryString, config = {}) {
  const date = new Date(`${dateString}T00:00:00`);
  const expiry = new Date(`${expiryString}T00:00:00`);

  let tradingDaysToExpiry = 0;

  for (
    let current = new Date(date.getTime() + DAY_MS);
    current <= expiry;
    current = new Date(current.getTime() + DAY_MS)
  ) {
    if (current.getDay() !== 0 && current.getDay() !== 6) {
      tradingDaysToExpiry++;
    }
  }

  const tenderDays = Number(
    config.tender_period_trading_days ?? 3
  );

  const daysToExit = tradingDaysToExpiry - tenderDays;
  const squareOffTime = config.square_off_time || '21:00';

  let status = 'ACTIVE';

  if (tradingDaysToExpiry <= 0) {
    status = 'EXPIRED';
  } else if (daysToExit === 0) {
    status = `ACT TODAY BY ${squareOffTime}`;
  } else if (daysToExit < 0) {
    status = 'TENDER OPEN / PAST SAFE EXIT';
  } else if (daysToExit <= Number(config.warn_days ?? 5)) {
    status = 'EXIT SOON';
  }

  return { tradingDaysToExpiry, daysToExit, status };
}

function labelRow(row, config) {
  const tags = [];
  const reasons = [];

  if (row.basisPct == null) {
    tags.push('NEEDS SPOT');
    reasons.push(
      'A verified spot price is required for fair-value analysis'
    );
  } else if (row.basisPct > config.richPct) {
    tags.push('RICH');
    reasons.push(`+${row.basisPct.toFixed(2)}% vs fair`);
  } else if (row.basisPct < -config.cheapPct) {
    tags.push('CHEAP');
    reasons.push(`${row.basisPct.toFixed(2)}% vs fair`);
  }

  const contract = CONTRACTS[row.symbol] || { lotGrams: 1 };

  const costs = calculateCost(
    row.pg,
    contract.lotGrams,
    config.broker || {}
  );

  row.costPerGram = costs.costPerGram;
  row.costPct = costs.costPct;

  const gap = row.fair == null
    ? null
    : Math.abs(row.pg - row.fair);

  if (
    (tags.includes('RICH') || tags.includes('CHEAP')) &&
    gap != null &&
    row.costPerGram >= gap
  ) {
    tags.push('COST>GAP');
    reasons.push(
      `cost ₹${row.costPerGram.toFixed(2)}/g >= gap ₹${gap.toFixed(2)}/g`
    );
  }

  row.exitGuard = calculateExitGuard(
    row.date,
    row.expiry,
    config.exit_guard || {}
  );

  const status = row.exitGuard.status;

  if (
    status === 'EXIT SOON' ||
    status === 'TENDER OPEN / PAST SAFE EXIT' ||
    status.startsWith('ACT TODAY')
  ) {
    tags.push('EXIT GUARD');
    reasons.push(status);
  }

  if (row.zCross != null && row.zCross > config.zLimit) {
    tags.push('WIDE');
    reasons.push(`Same-expiry GOLDM deviation z=${row.zCross.toFixed(1)}`);
  } else if (row.zCross != null && row.zCross < -config.zLimit) {
    tags.push('TIGHT');
    reasons.push(`Same-expiry GOLDM deviation z=${row.zCross.toFixed(1)}`);
  }

  if (row.calAnnPct != null) {
    tags.push(row.calAnnPct > 0 ? 'CONTANGO' : 'BACKWARDATION');
  }

  if (row.days <= config.rollDays) {
    tags.push('ROLL');
    reasons.push(`${row.days} days left`);
  }

  if (row.volume < config.minVolume) {
    tags.push('THIN');
    reasons.push(`Volume ${row.volume}`);
  }

  row.tags = tags.length ? [...new Set(tags)] : ['OK'];
  row.why = reasons.length
    ? reasons.join('; ')
    : 'No configured alert triggered';
}

function generateBrief(rows, date) {
  if (!rows.length) {
    return `Market session ${date}: No contract observations available.`;
  }

  const fairRows = rows.filter(row => row.basisPct != null);
  const thinRows = rows.filter(row => row.tags.includes('THIN'));

  let brief =
    `Market session ${date}: ${rows.length} Bhavcopy observations loaded. `;

  if (fairRows.length) {
    const worst = [...fairRows].sort(
      (a, b) => Math.abs(b.basisPct) - Math.abs(a.basisPct)
    )[0];

    brief +=
      `${worst.symbol} (${worst.expiry}) has the largest fair-value deviation ` +
      `at ${worst.basisPct >= 0 ? '+' : ''}${worst.basisPct.toFixed(2)}%. `;
  } else {
    brief += 'Fair-value signals require a verified spot-price input. ';
  }

  if (thinRows.length) {
    brief += `${thinRows.length} observation(s) flagged for low volume. `;
  }

  return brief.trim();
}

export async function analyseSession(date) {
  const dates = await getSessions();
  const selectedDate = date || dates.at(-1);

  if (!selectedDate || !dates.includes(selectedDate)) {
    return { date: selectedDate, dates, rows: null };
  }

  const rawRows = await MarketRow.find({
    date: { $lte: selectedDate },
    source: 'csv'
  })
    .sort({ date: 1, symbol: 1, expiry: 1 })
    .lean();

  const spotPerGram = Number(process.env.MCX_SPOT_PER_GRAM || 0);
  const carryRate =
    Number(process.env.MCX_CARRY_RATE_PCT ?? CONFIG.carryPct ?? 0) / 100;

  const enriched = rawRows.map(row => {
    const contract = CONTRACTS[row.symbol] || {
      quoteGrams: 10,
      lotGrams: 1
    };

    const pg = row.settlePaise / 100 / contract.quoteGrams;

    const days = Math.round(
      (
        new Date(`${row.expiry}T00:00:00`) -
        new Date(`${row.date}T00:00:00`)
      ) / DAY_MS
    );

    const fair = spotPerGram > 0
      ? spotPerGram * (1 + carryRate * days / 365)
      : null;

    const basisPct = fair == null || fair <= 0
      ? null
      : (pg / fair - 1) * 100;

    return { ...row, pg, days, fair, basisPct };
  });

  const sameDayExpiry = new Map(
    enriched.map(row => [
      `${row.date}|${row.expiry}|${row.symbol}`,
      row
    ])
  );

  for (const row of enriched) {
    const reference = sameDayExpiry.get(
      `${row.date}|${row.expiry}|GOLDM`
    );

    row.goldPg = reference?.pg ?? null;

    row.cross =
      row.symbol === 'GOLDM' || !reference
        ? null
        : row.pg - reference.pg;

    row.premiumPct =
      row.symbol === 'GOLDM' || !reference || !reference.pg
        ? null
        : (row.pg / reference.pg - 1) * 100;
  }

  const histories = new Map();

  for (const row of enriched) {
    const key = `${row.symbol}|${row.expiry}`;

    if (!histories.has(key)) histories.set(key, []);

    const history = histories.get(key);

    row.zBasis = zScore(
      history.map(item => item.basisPct),
      row.basisPct,
      CONFIG.zWindow
    );

    row.zCross = row.cross == null
      ? null
      : zScore(
          history
            .filter(item => item.cross != null)
            .map(item => item.cross),
          row.cross,
          CONFIG.zWindow
        );

    history.push(row);
  }

  const currentRows = enriched.filter(
    row => row.date === selectedDate
  );

  const grouped = new Map();

  for (const row of [...currentRows].sort(
    (a, b) =>
      a.symbol.localeCompare(b.symbol) ||
      a.expiry.localeCompare(b.expiry)
  )) {
    if (!grouped.has(row.symbol)) grouped.set(row.symbol, []);
    grouped.get(row.symbol).push(row);
  }

  for (const rows of grouped.values()) {
    rows.forEach((row, index) => {
      const previous = rows[index - 1];

      row.calAnnPct =
        previous && row.days !== previous.days
          ? (
              (row.pg / previous.pg - 1) *
              365 /
              (row.days - previous.days)
            ) * 100
          : null;

      labelRow(row, CONFIG);
    });
  }

  const resultRows = currentRows
    .sort((a, b) => b.pg - a.pg)
    .map(row => ({
      date: row.date,
      symbol: row.symbol,
      expiry: row.expiry,
      pg: Number(row.pg.toFixed(2)),
      fair: row.fair == null ? null : Number(row.fair.toFixed(2)),
      basisPct: row.basisPct == null
        ? null
        : Number(row.basisPct.toFixed(3)),
      costPerGram: Number((row.costPerGram || 0).toFixed(2)),
      costPct: Number((row.costPct || 0).toFixed(3)),
      exitGuard: row.exitGuard,
      zBasis: row.zBasis == null ? null : Number(row.zBasis.toFixed(2)),
      zCross: row.zCross == null ? null : Number(row.zCross.toFixed(2)),
      premiumPct: row.premiumPct == null
        ? null
        : Number(row.premiumPct.toFixed(3)),
      volume: row.volume,
      days: row.days,
      tags: row.tags,
      why: row.why,
      source: 'csv'
    }));

  return {
    date: selectedDate,
    dates,
    rows: resultRows,
    brief: generateBrief(resultRows, selectedDate),
    source: 'csv'
  };
}
