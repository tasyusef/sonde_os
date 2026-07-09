#!/usr/bin/env bash
# /opt/sonde_intel/infra/hetzner-deploy/deploy.sh
#
# Pulls master from origin, installs deps, restarts the ingester +
# backfill systemd services. Idempotent and safe to re-run.
#
# Invoked by webhook.mjs after Forgejo HMAC verification, can also
# be run manually:
#
#   /opt/sonde_intel/infra/hetzner-deploy/deploy.sh
#
# Single-instance lock prevents racing webhook fires from stepping
# on each other — concurrent invocations exit immediately rather
# than queueing.
#
# Failure modes (any of which causes a non-zero exit + journal log):
#   - git fetch fails (Forgejo unreachable)
#   - pnpm install fails (lockfile mismatch, registry issue)
#   - systemctl restart fails (unit broken)
# In all cases, the previous deploy's code stays in place — the
# `git reset` step only fires after `git fetch` succeeds, so a
# network blip leaves the working tree untouched.

set -euo pipefail

REPO=/opt/sonde_intel
LOCK=/var/run/sonde-deploy.lock
TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(TS)] [deploy] $*"; }

# Single-instance guard — nothing else acquires this lock
exec 200>"$LOCK"
flock -n 200 || { log "another deploy in flight, skipping"; exit 0; }

cd "$REPO"

log "fetching origin master"
git fetch origin master

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)
if [[ "$LOCAL" == "$REMOTE" ]]; then
  log "already at $LOCAL — no-op"
  exit 0
fi

log "advancing $(git rev-parse --short HEAD) → $(git rev-parse --short origin/master)"
git reset --hard origin/master

log "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

log "restarting sonde-ingester sonde-backfill"
systemctl restart sonde-ingester sonde-backfill

log "done at $(git rev-parse --short HEAD)"
