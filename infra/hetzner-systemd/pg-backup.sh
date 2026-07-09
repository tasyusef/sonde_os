#!/usr/bin/env bash
# /opt/sonde_intel/infra/hetzner-systemd/pg-backup.sh
#
# Nightly Postgres backup → Cloudflare R2.
#
# Invoked by sonde-pg-backup.timer (04:00 UTC daily). Reads DATABASE_URL
# from /opt/sonde_intel/.env (loaded by the systemd unit's
# EnvironmentFile directive).
#
# Output object: R2:sonde-pg-backups/YYYY/MM/DD/sonde-<ISO-TS>.dump.gz
#
# Retention: deletes objects older than 30 days. Tier into daily/weekly
# later if storage cost ever becomes a thing (R2 storage is $0.015/GB/mo,
# free up to 10 GB).
#
# Failure exits non-zero — systemd logs the failure to journald, the
# ops-monitor script (if installed) raises a Discord alert.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "[pg-backup] DATABASE_URL not set (check /opt/sonde_intel/.env)" >&2
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "[pg-backup] rclone not installed — see infra/hetzner-systemd/README.md" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[pg-backup] pg_dump not installed (apt install postgresql-client-17)" >&2
  exit 1
fi

TS=$(date -u +"%Y-%m-%dT%H-%M-%SZ")
PARTITION=$(date -u +"%Y/%m/%d")
TMP=$(mktemp /tmp/sonde-pg-XXXXXX.dump.gz)
trap 'rm -f "$TMP"' EXIT

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [pg-backup] $*"; }

log "starting pg_dump"
pg_dump --format=custom --compress=0 "$DATABASE_URL" | gzip -6 > "$TMP"
SIZE=$(du -h "$TMP" | cut -f1)
log "dump complete ($SIZE)"

DEST="R2:sonde-pg-backups/${PARTITION}/sonde-${TS}.dump.gz"
log "uploading → ${DEST}"
rclone copyto "$TMP" "$DEST" --s3-no-check-bucket
log "upload complete"

log "pruning backups older than 30 days"
rclone delete "R2:sonde-pg-backups/" \
  --min-age 30d \
  --include "*.dump.gz" \
  2>&1 | tee /dev/stderr | tail -5 || true

log "done"
