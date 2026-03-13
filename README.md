# Is This Thing On

A lightweight real-time payment monitor for AlbyHub (or any NWC-compatible Lightning wallet). Built for Podcasting 2.0 / Value4Value streaming — quickly see which splits are failing without digging through your wallet dashboard.

## Features

- Connects via **NWC (Nostr Wallet Connect)** — no API keys, just your NWC string
- Polls `list_transactions` every 5 seconds
- Highlights **failed payments** prominently
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
- nostr-tools (NIP-04 encryption, event signing)
- NIP-47 (Nostr Wallet Connect protocol)
- Zero backend — runs entirely in the browser
