# CLAUDE.md — Is This Thing On

## Purpose
Browser-only NWC (Nostr Wallet Connect) Lightning payment monitor for Podcasting 2.0 / Value4Value. Connects to any NWC-compatible wallet (e.g. AlbyHub) and displays real-time payment status — especially useful for spotting failed splits.

## Commands
```bash
npm run dev       # Vite dev server (localhost:5173)
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
```

## Architecture
- **React 18 + Vite 6** single-page app, no backend
- **NIP-47** (Nostr Wallet Connect) protocol via `nostr-tools`
- **BOLT11** invoice decoding via `light-bolt11-decoder`
- NWC connection string never leaves the browser

## Key Files
| File | Role |
|------|------|
| `src/useNWC.js` | React hook: connects to relay, signs/encrypts NWC requests, polls `list_transactions` |
| `src/lightning.js` | BOLT11 decoding helpers + node pubkey → alias lookup |
| `src/components/ConnectionForm.jsx` | NWC string input + connect button |
| `src/components/PaymentFeed.jsx` | Transaction list with filters (state, direction) and expandable details |
| `src/App.jsx` | Root component, composes ConnectionForm + PaymentFeed |

## Deploy
Vercel with Vite preset auto-detection. No environment variables needed. Build output is `dist/`.
