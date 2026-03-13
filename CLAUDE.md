# CLAUDE.md — Is This Thing On

## Purpose
Browser-only NWC (Nostr Wallet Connect) Lightning payment monitor for Podcasting 2.0 / Value4Value. Connects to any NWC-compatible wallet (e.g. self-hosted AlbyHub) and displays real-time payment status — especially useful for spotting failed splits.

## Commands
```bash
npm run dev       # Vite dev server (localhost:5173)
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
```

## Architecture
- **React 18 + Vite 6** single-page app, no backend
- **@getalby/sdk** `NWCClient` for NWC protocol (NIP-47)
- Real-time via `subscribeNotifications` (payment_sent, payment_received); falls back to `listTransactions` polling if notifications unavailable
- **V4V TLV parsing**: keysend TLV type `7629169` contains hex-encoded JSON with podcast metadata (podcast, episode, action, sender_name, name/recipient, message, app_name, etc.)
- **BOLT11** invoice decoding via `light-bolt11-decoder`; node alias lookup via mempool.space API
- NWC connection string saved to `localStorage` with auto-reconnect on page load
- Light theme (CSS custom properties in `src/index.css`)

## Key Files
| File | Role |
|------|------|
| `src/useNWC.js` | React hook: connects via @getalby/sdk NWCClient, subscribes to notifications, manages transactions state |
| `src/lightning.js` | BOLT11 decoding helpers + node pubkey → alias lookup (mempool.space) |
| `src/components/ConnectionForm.jsx` | NWC string input + connect/disconnect, accepts `savedUri` prop |
| `src/components/PaymentFeed.jsx` | Transaction list with filters, V4V split grouping, expandable details |
| `src/App.jsx` | Root component, localStorage persistence, auto-connect |

## Key Patterns
- **V4V TLV parsing**: `parseV4V()` returns the full decoded TLV 7629169 object; `parseV4VName()` is a convenience wrapper for the `name` field
- **Split grouping**: V4V payments are grouped by `action|podcast|episode|timeBucket(30s)`. Groups show as collapsible rows with success/fail ratio (e.g. "8/8 ✓"). Only payments with matching V4V TLV metadata are grouped — plain keysends without TLV stay ungrouped (this is correct; no guessing)
- **`GroupRow` vs `TransactionRow`**: groups of 2+ V4V splits render as `GroupRow` (collapsible, shows splits); single payments render as `TransactionRow`
- **RSS payment parsing**: `parseRssPayment()` extracts action/message from `rss::payment::boost` descriptions on incoming payments (e.g. Fountain boosts)
- **Incoming vs outgoing styling**: incoming payments get green accent (border + destination text), outgoing keeps default orange
- **Alby hosted NWC**: `list_transactions` times out on Alby's relay but notifications work fine; code handles this gracefully

## Deploy
Vercel with Vite preset auto-detection. No environment variables needed. Build output is `dist/`.
