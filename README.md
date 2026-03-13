# Is This Thing On

A lightweight real-time payment monitor for AlbyHub (or any NWC-compatible Lightning wallet). Built for Podcasting 2.0 / Value4Value streaming — quickly see which splits are failing without digging through your wallet dashboard.

## Features

- Connects via **NWC (Nostr Wallet Connect)** — no API keys, just your NWC string
- Real-time notifications via `subscribeNotifications`; falls back to polling
- **V4V split grouping** — boost and stream splits are grouped into collapsible rows showing success/fail ratio (e.g. "8/8 ✓" or "6/8 !")
- Expand a group to see individual splits with recipient names, amounts, fees, and error messages
- Highlights **failed payments** prominently — both individual and within groups
- Incoming payments (e.g. Fountain boosts) parsed to show action type and message
- Filter by state (failed / succeeded / pending) and direction (outgoing / incoming)
- Click any transaction to expand full details including error messages and payment hash
- Your NWC secret never leaves your browser

## Deploy

### Vercel (recommended)

1. Fork or push this repo to GitHub
2. Import the repo at [vercel.com/new](https://vercel.com/new)
3. Framework preset: **Vite**
4. Deploy — no environment variables needed

### Local dev

```bash
npm install
npm run dev
```

## Usage

1. Open your deployed app (or `localhost:5173`)
2. Go to your AlbyHub → **Settings → Nostr Wallet Connect** → copy the connection string
3. Paste it into the app and hit **CONNECT**
4. Start streaming sats — failed payments will show up highlighted in red

## Tech

- Vite + React
- @getalby/sdk (NWCClient, NIP-47)
- light-bolt11-decoder (invoice decoding)
- V4V TLV parsing (keysend type 7629169)
- Zero backend — runs entirely in the browser
