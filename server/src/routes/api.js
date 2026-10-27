
import { Router } from 'express';
import { CONFIG } from '../../config.js';
import {
  analyseSession,
  getSessions,
  getHistory
} from '../services/marketData.js';
import { getLiveGoldSpot } from '../services/spotPrice.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

router.get('/sessions', async (_req, res, next) => {
  try {
    res.json({ dates: await getSessions() });
  } catch (error) {
    next(error);
  }
});

router.get('/spot', async (_req, res) => {
  try {
    res.json(await getLiveGoldSpot());
  } catch (error) {
    res.status(503).json({
      error: error.message || 'Live MCX spot data is unavailable.',
      provider: 'MCX',
      available: false
    });
  }
});

router.get('/rows', async (req, res, next) => {
  try {
    const result = await analyseSession(
      req.query.date ? String(req.query.date) : undefined
    );

    if (!result.rows) {
      return res.status(404).json({
        error: `No session on ${result.date}`,
        first: result.dates[0] ?? null,
        last: result.dates.at(-1) ?? null,
        dates: result.dates
      });
    }

    let spot = null;
    let spotError = null;

    try {
      spot = await getLiveGoldSpot();
    } catch (error) {
      spotError = error.message;
    }

    const annualRate =
      Number(process.env.MCX_FINANCING_RATE_PCT ?? CONFIG.carryPct ?? 6) +
      Number(process.env.MCX_ADDITIONAL_CARRY_PCT ?? 0);

    const rows = result.rows.map(row => {
      if (!spot || !Number.isFinite(Number(row.days))) {
        return {
          ...row,
          fair: null,
          basisPct: null,
          spotPerGram: null,
          fairValueSource: null,
          tags: [
            ...(row.tags || []).filter(
              tag => !['RICH', 'CHEAP'].includes(tag)
            ),
            'NEEDS SPOT'
          ]
        };
      }

      const days = Math.max(0, Number(row.days));

      const fair = spot.pricePerGram *
        (1 + (annualRate / 100) * days / 365);

      const basisPct = fair > 0
        ? ((Number(row.pg) - fair) / fair) * 100
        : null;

      const tags = (row.tags || []).filter(
        tag => !['RICH', 'CHEAP', 'NEEDS SPOT'].includes(tag)
      );

      if (basisPct != null && basisPct > CONFIG.richPct) {
        tags.push('RICH');
      } else if (basisPct != null && basisPct < -CONFIG.cheapPct) {
        tags.push('CHEAP');
      }

      return {
        ...row,
        fair: Number(fair.toFixed(2)),
        basisPct: basisPct == null ? null : Number(basisPct.toFixed(3)),
        spotPerGram: spot.pricePerGram,
        fairValueSource: 'MCX spot + simplified cost of carry',
        tags: [...new Set(tags)]
      };
    });

    return res.json({
      date: result.date,
      source: 'csv',
      dates: result.dates,
      spot,
      spotError,
      fairValueModel: {
        name: 'Simplified cost of carry',
        annualRatePct: annualRate,
        formula: 'Fair = Spot × (1 + annualRate × daysToExpiry / 365)'
      },
      rows
    });
  } catch (error) {
    next(error);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const symbol = String(req.query.symbol || 'GOLDM').toUpperCase();
    const history = await getHistory(symbol);

    res.json({
      symbol,
      source: 'csv',
      count: history.length,
      rows: history
    });
  } catch (error) {
    if (error.message.startsWith('Invalid symbol')) {
      return res.status(400).json({ error: error.message });
    }

    next(error);
  }
});

export default router;
