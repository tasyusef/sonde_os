# Sonde

A free, easy-to-read explorer for the XRP Ledger. Live at **[sondelab.com](https://sondelab.com)**.

Look up any account, transaction, ledger, token or NFT and understand it. No sign-in, no paid tier, no tracking cookies.

## What it does
- **One search box** for addresses, transaction hashes, ledger numbers, NFT IDs and token names.
- **Accounts:** balance and reserve, then tabs for transactions, positions (tokens, trust lines, escrows, payment channels), offers, NFTs, issued tokens, and a profile with its settings, objects and who funded it.
- **Transactions:** who did what, the balance changes, and the ledger objects each one touched.
- **Ledgers, tokens and NFTs:** a ledger's transactions by type, a token's issuer, holders and AMM pool, an NFT's media and offers.
- **Network:** a live feed of every ledger as it closes, the XRP price on a pixel chart, and amendments with their validator votes.
- **Watchlist:** saved accounts with your own labels, kept in your browser.
- **Docs:** a plain-language guide to the XRP Ledger and to reading Sonde.

## How it works
- **No backend.** The site is static files on Cloudflare. Every page reads public XRPL nodes from your browser over WebSocket, with failover between nodes.
- **Live feed relay.** A small Rust Worker on a Cloudflare Durable Object holds one node connection and sends each visitor a compact snapshot per ledger: 20–65 KB instead of a 0.3–0.8 MB ledger.
- **$0 to run.** Both fit Cloudflare's free plan.

## Design
A pixel design system: everything is set in bitmap faces on whole pixels (PARC Pixel for Sonde's own labels, Departure Mono for data and text), with square shapes, hard 1px edges and dither fills instead of boxes. Yellow marks the primary action and where you are. Each transaction family has its own OKLCH hue, checked for contrast in both themes. Icons, the logo and the globe are drawn on the same pixel grid. Dark and light themes; motion is springs and stops under reduced motion. Tokens live in `src/globals.css`; `/designsystem` shows them.

## Stack
React 19 · React Router 8 (framework mode, static SPA) on Vite · TypeScript · Tailwind CSS v4 · Motion · SWR · Zod. The relay is Rust (`workers-rs`). Tests are Vitest, plus the relay's cargo tests.

## Run locally
Requires Node 24 LTS (`.nvmrc`) and pnpm.

```bash
pnpm install
```

```bash
pnpm dev
```

It works with no `.env.local`: pages read public XRPL nodes directly. Optional settings are in [`.env.example`](.env.example).

### Live relay
The live feed on `/network` and the account page comes from the relay in `relay/`; without it those pages skip the feed. Rust (stable) with the `wasm32-unknown-unknown` target is needed. Run it with `pnpm relay:dev` and add to `.env.local`:

```env
VITE_LIVE_RELAY_URL=ws://127.0.0.1:8788/live
```

The relay only accepts pages on `localhost:3000` and `:3001` (`ALLOWED_ORIGINS` in `relay/wrangler.toml`).

## Commands
| Command | What it does |
|---|---|
| `pnpm dev` | Dev server on `localhost:3000` |
| `pnpm build` | Static build in `build/client`: prerendered pages, the SPA shell, `_headers`, `_redirects`, sitemap |
| `pnpm preview` | Serves `build/client` the way Cloudflare does (`wrangler dev`, port 3000) |
| `pnpm check` | Typecheck + lint + tests, plus the relay's fmt/clippy/tests (also runs before every push and in CI) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm relay:dev` | Live relay on `127.0.0.1:8788` |
| `pnpm brand` | Redraws the icons and link-preview images from the logo bitmaps |
| `pnpm tokens` | Rebuilds the token list that search uses |
| `pnpm audit:code` | Finds orphaned files, unused exports and unused dependencies |

## Deploys
The site deploys through Cloudflare Workers Builds on every push to `master`. The relay deploys by hand with `pnpm relay:deploy`.

## License
MIT. The first version (Next.js, ClickHouse and Postgres, shut down July 2026) is the previous commit in this repo's history.

Built by [Timothy Ali](https://timothyali.com).
