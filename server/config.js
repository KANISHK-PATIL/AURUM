export const CONFIG = {
  dutyPct: 0.06,
  carryPct: 0.06,
  richPct: 0.5,
  cheapPct: 0.5,
  zWindow: 20,
  zLimit: 2,
  rollDays: 5,
  minVolume: 50,
  broker: {
    flat_brokerage_per_order: 0,
    pct_brokerage: 0,
    exchange_charge_per_order: 0,
    exchange_charge_pct: 0,
    sell_side_tax_pct: 0,
    gst_on_fees_pct: 0
  },
  exit_guard: {
    tender_period_trading_days: 3,
    warn_days: 5,
    square_off_time: "21:00"
  }
};

export const CONTRACTS = {
  GOLD: { lotGrams: 1000, quoteGrams: 10, premium: 0, deliveryType: 'staggered' },
  GOLDM: { lotGrams: 100, quoteGrams: 10, premium: 0.0003, deliveryType: 'staggered' },
  GOLDTEN: { lotGrams: 10, quoteGrams: 10, premium: 0.0005, deliveryType: 'staggered' },
  GOLDGUINEA: { lotGrams: 8, quoteGrams: 8, premium: 0.0015, deliveryType: 'staggered' },
  GOLDPETAL: { lotGrams: 1, quoteGrams: 1, premium: 0.003, deliveryType: 'compulsory' },
  GOLDPETALM: { lotGrams: 1, quoteGrams: 1, premium: 0.0025, deliveryType: 'compulsory' }
};
export const OZ_GRAMS = 31.1035;
