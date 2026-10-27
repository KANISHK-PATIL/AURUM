# MCX Gold Relative Pricing — MERN Stack

Converted from the supplied Python/FastAPI project to **MongoDB, Express, React, and Node.js**.

## Features
- Per-gram price ladder for GOLD, GOLDM, GOLDTEN, GOLDGUINEA and GOLDPETAL.
- Fair value based on COMEX gold, USD/INR, import duty and annual carry.
- Basis percentage, premium over GOLD, rolling z-scores and explanatory tags.
- Date replay, JSON API, and plain-text `/tags.txt` export.
- Deterministic synthetic data generated on first start, so it works offline.
- Editable analysis settings in `server/config.js`.

> Synthetic values are demonstration data, not live market prices or investment advice. This MVP does not yet ingest MCX bhavcopy CSVs or fetch live COMEX/FX quotes.

## Requirements
- Node.js 20+
- MongoDB running locally or a MongoDB Atlas URI

## Run locally

### 1. Configure backend
```bash
cd server
cp .env.example .env
npm install
npm run dev
```

### 2. Run frontend in another terminal
```bash
cd client
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally http://localhost:5173). Vite proxies `/api` and `/tags.txt` to the Express server on port 5000.

## Environment
`server/.env`
```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/gold_commodity
```

## API
- `GET /api/rows` — rows for latest session
- `GET /api/rows?date=YYYY-MM-DD` — replay a session
- `GET /api/sessions` — available session dates
- `GET /tags.txt?date=YYYY-MM-DD` — greppable plain-text tag export
- `GET /api/health` — health check

## Notes
- Contract quote units are retained from the source project: `GOLD`/`GOLDM`/`GOLDTEN` quote per 10g, `GOLDGUINEA` per 8g, `GOLDPETAL` per 1g.
- Verify contract specifications against the current MCX contract specifications before using this for real analysis.
