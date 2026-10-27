
const MCX_SPOT_URL =
  'https://www.mcxindia.com/backpage.aspx/GetSpotMarketPrice';

function unwrapResponse(body) {
  let value = body?.d ?? body;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('MCX returned an unrecognized response.');
    }
  }

  if (Array.isArray(value)) return value;

  if (value && typeof value === 'object') {
    for (const key of ['data', 'Data', 'result', 'Result', 'Table']) {
      if (Array.isArray(value[key])) return value[key];
    }
  }

  throw new Error('MCX spot response did not contain a data array.');
}

function field(row, names) {
  const wanted = names.map(name => name.toLowerCase());

  for (const [key, value] of Object.entries(row)) {
    if (wanted.includes(key.toLowerCase())) return value;
  }

  return null;
}

function parseNumber(value) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function getLiveGoldSpot() {
  const response = await fetch(MCX_SPOT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://www.mcxindia.com',
      Referer: 'https://www.mcxindia.com/'
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    throw new Error(`MCX spot request failed with HTTP ${response.status}.`);
  }

  const body = await response.json();
  const rows = unwrapResponse(body);

  const goldRows = rows.filter(row => {
    const commodity = String(
      field(row, ['Commodity', 'Product', 'Symbol', 'Name']) ?? ''
    ).toUpperCase();

    return commodity === 'GOLD';
  });

  if (!goldRows.length) {
    throw new Error(
      'No GOLD record returned by MCX. The endpoint may require a permitted data feed or a different request payload.'
    );
  }

  const row = goldRows[0];

  const rawPrice = parseNumber(
    field(row, [
      'Spot Price (Rs.)',
      'SpotPrice',
      'Price',
      'Rate',
      'Close'
    ])
  );

  if (!rawPrice) {
    throw new Error('MCX returned a GOLD record without a valid price.');
  }

  const unit = String(
    field(row, ['Unit', 'PriceUnit', 'Quotation']) ?? ''
  ).toUpperCase();

  let pricePerGram;

  if (unit.includes('10')) {
    pricePerGram = rawPrice / 10;
  } else if (unit.includes('8')) {
    pricePerGram = rawPrice / 8;
  } else if (unit.includes('GRAM')) {
    pricePerGram = rawPrice;
  } else {
    throw new Error(
      `Cannot safely determine the unit of the MCX gold price: "${unit || 'missing'}".`
    );
  }

  return {
    provider: 'MCX',
    commodity: 'GOLD',
    rawPrice,
    unit,
    pricePerGram: Number(pricePerGram.toFixed(4)),
    date: field(row, ['Date', 'RateDate', 'TradeDate']) ?? null,
    location: field(row, ['Location', 'Centre', 'City']) ?? null,
    fetchedAt: new Date().toISOString()
  };
}
