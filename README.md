# Sonde

XRPL block explorer and on-chain intelligence platform. Sonde connects to the XRP Ledger over WebSockets, ingests every transaction in real time into ClickHouse, and serves data-dense analytics: accounts, transactions, tokens, NFTs, DEX activity, network health, portfolio tracking, and a "smart money" scoring engine that ranks wallets by risk-adjusted trading performance.

Built and operated by [Timothy Ali](https://timothyali.com).

## Highlights

- **Real-time ingestion pipeline** — a single idempotent `ingestLedger()` path shared by the live ledger subscriber and a multi-worker historical backfill. Crash-safe by construction: ClickHouse `ReplacingMergeTree` dedup + idempotent Postgres upserts, with the ledger pointer advance as the atomicity gate.
- **Two-store architecture** — ClickHouse for OLAP (raw transactions, DEX trades, NFT activity, value-transfer events, dozens of materialized-view rollups), Postgres for OLTP (auth, subscriptions, watchlists, alerts, job state) via Drizzle.
- **Smart money scoring** — composite 0–100 score (profitability via WAVG cost basis, ROI, win rate, Sharpe-style consistency, early-buyer signal, exit timing) with wash-trading detection penalties. Runs as a daily systemd timer.
- **AI query interface** — natural-language questions over ledger data ("Ask the Ledger"), with an XRPL-scoped prompt, SQL routing, and prompt-injection guards. Supports managed keys or BYOK.
- **Wallet-native auth** — sign-in with Xaman (XRPL wallet) challenge signatures, JWT sessions via `jose`, Stripe + on-chain crypto billing.

## Tech Stack

- **Framework:** Next.js 16 (App Router, Server Components), React 19, TypeScript
- **Styling:** Tailwind CSS v4 (token-driven design system), Motion for animation
- **Data:** ClickHouse (`@clickhouse/client`) + PostgreSQL (Drizzle ORM + `postgres`)
- **XRPL:** `xrpl` + raw WebSocket singletons (page-serving, ingestion, and intelligence connections)
- **AI:** Anthropic / OpenAI / Google SDKs behind a model-router
- **Payments:** Stripe + native XRPL payment watcher
- **Realtime:** Server-Sent Events for the live ledger feed
- **Charts:** Recharts, d3-hierarchy, react-force-graph

## Repo tour

| Path | What's there |
|------|--------------|
| `src/app` | Routes — explorer pages, ~130 API routes (`analytics/`, `intel/`, `portfolio/`, `smart-money/`, …) |
| `src/lib` | The engine room: `ledger-ingester.ts`, `smart-money-scorer.ts`, `anomaly-detection.ts`, `alert-engine.ts`, ClickHouse/Postgres query layers, AI routing |
| `src/components` | Feature-scoped UI (account, nft, portfolio, intel, tokens…) plus a shared primitives library |
| `src/db` | Drizzle schema + migrations |
| `scripts` | Operational tooling — the migration runner, backfills, seeders, verification checks, cron entrypoints |
| `infra` | systemd units/timers, deploy webhook, ClickHouse config for the self-hosted data tier |

## Running locally

Prerequisites: Node ≥ 20.9, pnpm, a Postgres instance. ClickHouse is optional — analytics/intel features degrade gracefully when `CLICKHOUSE_URL` is unset.

Create `.env.local`:

```env
DATABASE_URL=postgresql://...          # Required — Postgres connection string
ENABLE_INGESTION=true                  # Starts the real-time XRPL ingestion pipeline

# Analytics / intelligence layer (optional)
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DATABASE=sonde

# Metadata + price providers (optional)
BITHOMP_API_KEY=...
CRYPTOCOMPARE_API_KEY=...

# AI query interface (optional)
ANTHROPIC_API_KEY=...

# Auth + billing (optional)
XUMM_API_KEY=...
XUMM_API_SECRET=...
AUTH_SECRET=...                        # JWT signing secret
STRIPE_SECRET_KEY=...
```

Then:

```bash
pnpm install
pnpm migrate        # Postgres schema (idempotent, also runs on every deploy)
pnpm dev            # http://localhost:3000
```

ClickHouse schema setup (if using the analytics layer): `pnpm tsx scripts/setup-clickhouse.ts`.

## Verification

```bash
pnpm typecheck
pnpm lint
```

Both run automatically on pre-push via `simple-git-hooks`.

## License

[MIT](LICENSE)
