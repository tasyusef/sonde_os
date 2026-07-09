# Hetzner systemd units

Systemd units that run the Sonde ingester, backfill, scheduled crons, and
nightly PG backup on the Hetzner box. Mirrored here so they're version
controlled — the live copies live in `/etc/systemd/system/` on the box.

The deploy webhook (`sonde-deploy.service`) lives in
[`../hetzner-deploy/`](../hetzner-deploy/) instead — it's tightly coupled
with the deploy script + listener.

## Units

| Unit | Type | Schedule | Status today |
|---|---|---|---|
| `sonde-ingester.service` | long-running | always | enabled, running |
| `sonde-backfill.service` | long-running (one-shot semantic) | always until done | enabled, running |
| `sonde-holder-snapshot.{service,timer}` | timer-fired oneshot | every 4h | installed, **disabled** until cutover |
| `sonde-smart-money-scorer.{service,timer}` | timer-fired oneshot | every 6h | installed, **disabled** until cutover |
| `sonde-pg-backup.{service,timer}` | timer-fired oneshot | nightly 04:00 UTC | installed, **disabled** until rclone is configured |
| `sonde-ch-cleanup.{service,timer}` | timer-fired oneshot | weekly Sun 03:00 UTC | installed, enabled (belt-and-suspenders for CH system log tables) |

The cron + backup units are intentionally disabled until the Railway →
Hetzner migration cuts over. Enabling them prematurely means double-firing
with the Railway-side schedules.

The CH cleanup timer is safe to enable any time — it TRUNCATEs ClickHouse
system log tables (text_log, query_log, etc.) which are debug-only and
unrelated to Sonde data. Pairs with the `<level>warning</level>` override
in [`../clickhouse-config/sonde-overrides.xml`](../clickhouse-config/sonde-overrides.xml).

## Install

```bash
# 1. Copy units into systemd
cp /opt/sonde_intel/infra/hetzner-systemd/*.{service,timer} /etc/systemd/system/

# 2. Make scripts executable
chmod +x /opt/sonde_intel/infra/hetzner-systemd/pg-backup.sh

# 3. Reload systemd
systemctl daemon-reload

# 4. Enable + start whatever you need
#    Currently running:
systemctl enable --now sonde-ingester sonde-backfill

#    To enable when ready (post-cutover):
# systemctl enable --now sonde-holder-snapshot.timer sonde-smart-money-scorer.timer sonde-pg-backup.timer
```

## pg-backup.sh prerequisites

The backup script uses `rclone` to upload to Cloudflare R2. One-time
setup on the box:

```bash
# 1. Install rclone
curl https://rclone.org/install.sh | bash

# 2. Configure R2 remote (interactive — answer the prompts)
rclone config
#   - n (new remote)
#   - name: R2
#   - storage: s3
#   - provider: Cloudflare
#   - env_auth: false
#   - access_key_id: <from CF R2 token>
#   - secret_access_key: <from CF R2 token>
#   - region: auto
#   - endpoint: <https://<account>.r2.cloudflarestorage.com>
#   - acl: private

# 3. Sanity check
rclone lsd R2:
# expects: sonde-pg-backups (or whatever bucket name)

# 4. Dry-run the backup script
DATABASE_URL="postgresql://..." /opt/sonde_intel/infra/hetzner-systemd/pg-backup.sh
# should produce a .dump.gz in R2:sonde-pg-backups/YYYY/MM/DD/

# 5. Restore drill (do this once, before relying on the backup)
rclone copy R2:sonde-pg-backups/YYYY/MM/DD/sonde-...dump.gz /tmp/
gunzip /tmp/sonde-*.dump.gz
docker run --rm -v /tmp:/tmp postgres:17-alpine \
  pg_restore --list /tmp/sonde-*.dump | head
# Should list out all the tables. If it does, the dump is good.
```

## Logs

```bash
# Live tail
journalctl -u sonde-ingester -f
journalctl -u sonde-backfill -f

# Cron history
journalctl -u sonde-holder-snapshot --since today
journalctl -u sonde-smart-money-scorer --since today

# Backup history
journalctl -u sonde-pg-backup --since today
```

## Why not Docker for these?

The ingester + crons need `pnpm tsx` against the live repo at
`/opt/sonde_intel`. Putting them in Docker means rebuilding the image on
every deploy and losing the simple "git pull → systemctl restart" loop
that the Forgejo webhook handles. Once the app moves to Hetzner (Phase 2)
we revisit and probably containerize everything under Kamal.
