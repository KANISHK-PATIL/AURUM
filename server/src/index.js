import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import api from './routes/api.js';
import { analyseSession, seedSyntheticData } from './services/marketData.js';
import dns from 'node:dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);
const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', api);
app.get('/tags.txt', async (req, res, next) => {
  try {
    const result = await analyseSession(req.query.date);
    if (!result.rows) return res.status(404).type('text/plain').send(`No session on ${result.date}. Available ${result.dates[0]} to ${result.dates.at(-1)}.\n`);
    res.type('text/plain').send(result.rows.map(r=>`${result.date} ${r.symbol} ${r.expiry} ${r.tags.map(t=>`[${t}]`).join('')} ${r.why}`).join('\n')+'\n');
  } catch (e) { next(e); }
});
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 5000);
try {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gold_commodity');
  await seedSyntheticData();
  app.listen(port, () => console.log(`Gold Commodity API running on http://localhost:${port}`));
} catch (error) {
  console.error('Could not start API. Check MongoDB is running and MONGODB_URI is correct.', error.message);
  process.exit(1);
}
