
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dns from 'node:dns';
import api from './routes/api.js';
import {
  analyseSession,
  importBhavcopyData
} from './services/marketData.js';

dns.setServers(['8.8.8.8', '8.8.4.4']);

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api', api);

app.get('/tags.txt', async (req, res, next) => {
  try {
    const result = await analyseSession(req.query.date);

    if (!result.rows) {
      return res
        .status(404)
        .type('text/plain')
        .send(
          `No session on ${result.date}. ` +
          `Available dates: ${result.dates.join(', ')}\n`
        );
    }

    return res.type('text/plain').send(
      result.rows
        .map(row =>
          `${result.date} ${row.symbol} ${row.expiry} ` +
          `${row.tags.map(tag => `[${tag}]`).join(' ')} ${row.why}`
        )
        .join('\n') + '\n'
    );
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);

  res.status(500).json({
    error: error.message || 'Internal server error'
  });
});

const port = Number(process.env.PORT || 5000);
const mongoUri =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/gold_commodity';

try {
  await mongoose.connect(mongoUri);
  console.log('MongoDB connected.');

  await importBhavcopyData();

  app.listen(port, () => {
    console.log(`Gold Commodity API running on http://localhost:${port}`);
  });
} catch (error) {
  console.error('Could not start API:', error.message);
  process.exit(1);
}
