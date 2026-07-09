/**
 * Server-side initialization module.
 *
 * Import this from a server component (e.g. the app layout) to trigger
 * one-time server-side setup. Module-level code runs once per process.
 *
 * Uses dynamic import so that @/db (which requires DATABASE_URL) is
 * never loaded unless the database is configured.
 *
 * Per-manager initialization: each manager has its own flag. If one fails,
 * only that manager retries on the next request — others stay running.
 *
 * NOTE: Matcher scoped to ingestion managers only. Page-serving modules
 * (xrpl-client, cache, etc.) initialize themselves on first use.
 */

import "server-only";
import logger from "./logger";

const log = logger.child({ module: "init" });

// Per-manager idempotency flags — survives HMR, prevents double-init
const globalForInit = globalThis as unknown as {
  _managerInit?: Record<string, boolean>;
};
const initFlags = (globalForInit._managerInit ??= {});

const canInit = !!process.env.DATABASE_URL && process.env.ENABLE_INGESTION === "true";

if (canInit) {
  if (!initFlags.ingestion) {
    initFlags.ingestion = true;
    import("./ingestion")
      .then(({ initIngestion }) => initIngestion())
      .catch((err) => { log.error({ err }, "Ingestion init failed"); initFlags.ingestion = false; });
  }

  if (!initFlags.amendments) {
    initFlags.amendments = true;
    import("./amendment-data")
      .then(({ initAmendmentPolling }) => initAmendmentPolling())
      .catch((err) => { log.error({ err }, "Amendment polling init failed"); initFlags.amendments = false; });
  }

  if (!initFlags.holderSnapshots) {
    initFlags.holderSnapshots = true;
    import("./holder-snapshots")
      .then(({ initHolderSnapshots }) => initHolderSnapshots())
      .catch((err) => { log.error({ err }, "Holder snapshots init failed"); initFlags.holderSnapshots = false; });
  }

  if (!initFlags.ammTvlRefresher) {
    initFlags.ammTvlRefresher = true;
    import("./amm-tvl-refresher")
      .then(({ initAmmPoolTvlRefresher }) => initAmmPoolTvlRefresher())
      .catch((err) => { log.error({ err }, "AMM TVL refresher init failed"); initFlags.ammTvlRefresher = false; });
  }

  // Portfolio snapshots used to init here as an in-process setInterval
  // poller. Migrated to a Hetzner systemd timer (sonde-portfolio-
  // snapshot.timer, every 5 min) — Railway container recycles were
  // killing the timer, dropping the cadence from 12/hour to ~1/day.
  // The on-login `snapshotNow(address)` call in auth.ts still runs
  // in this process for fresh users.

  if (!initFlags.intelIngestion) {
    initFlags.intelIngestion = true;
    import("./intel-ingestion")
      .then(({ initIntelIngestion }) => initIntelIngestion())
      .catch((err) => { log.error({ err }, "Intel ingestion init failed"); initFlags.intelIngestion = false; });
  }

  if (!initFlags.paymentWatcher && process.env.SONDE_TREASURY_ADDRESS) {
    initFlags.paymentWatcher = true;
    import("./payment-watcher")
      .then(({ paymentWatcher }) => paymentWatcher.start())
      .catch((err) => { log.error({ err }, "PaymentWatcher init failed"); initFlags.paymentWatcher = false; });
  }

  if (!initFlags.subscriptionExpiry) {
    initFlags.subscriptionExpiry = true;
    import("./subscription-expiry")
      .then(({ initSubscriptionExpiry }) => initSubscriptionExpiry())
      .catch((err) => { log.error({ err }, "SubscriptionExpiryChecker init failed"); initFlags.subscriptionExpiry = false; });
  }

  if (!initFlags.alertEngine) {
    initFlags.alertEngine = true;
    import("./alert-engine")
      .then(({ initAlertEngine }) => initAlertEngine())
      .catch((err) => { log.error({ err }, "AlertEngine init failed"); initFlags.alertEngine = false; });
  }

  if (!initFlags.tokenPriceRefresher) {
    initFlags.tokenPriceRefresher = true;
    import("./token-price-refresher")
      .then(({ initTokenPriceRefresher }) => initTokenPriceRefresher())
      .catch((err) => { log.error({ err }, "TokenPriceRefresher init failed"); initFlags.tokenPriceRefresher = false; });
  }
} else if (!initFlags._loggedDisabled) {
  initFlags._loggedDisabled = true;
  if (!process.env.DATABASE_URL) {
    log.info("Ingestion disabled (no DATABASE_URL)");
  } else {
    log.info("Ingestion disabled (ENABLE_INGESTION !== 'true')");
  }
}
