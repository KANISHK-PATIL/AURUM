import { Router } from 'express';
import { analyseSession, getSessions } from '../services/marketData.js';
const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok' }));
router.get('/sessions', async (_req, res, next) => {
  try { res.json({ dates: await getSessions() }); } catch (e) { next(e); }
});
router.get('/rows', async (req, res, next) => {
  try {
    const result = await analyseSession(req.query.date);
    if (!result.rows) return res.status(404).json({ error: `No session on ${result.date}`, first: result.dates[0], last: result.dates.at(-1) });
    res.json({ date: result.date, source: result.source, rows: result.rows });
  } catch (e) { next(e); }
});
export default router;
