# ClickHouse config overrides

XML files in this directory get bind-mounted into the ClickHouse
container at `/etc/clickhouse-server/config.d/`. ClickHouse merges
files in `config.d/` into the running config at startup; check the
merged result via:

```bash
docker exec sonde-clickhouse-1 grep -A 12 '<text_log>' \
  /var/lib/clickhouse/preprocessed_configs/config.xml
```

## Files

| File | What it does |
|---|---|
| `sonde-overrides.xml` | Lowers `text_log` log level from `trace` to `warning` (kills ~50 GB/day of internal log noise) |

## Install

The compose file at `/opt/sonde/docker-compose.yml` (lives outside this
repo, on the box) needs to bind-mount each override file. Pattern for
the clickhouse service:

```yaml
clickhouse:
  ...
  volumes:
    - ch_data:/var/lib/clickhouse
    - /opt/sonde/ch-config/sonde-overrides.xml:/etc/clickhouse-server/config.d/sonde-overrides.xml:ro
```

After dropping a new file in `/opt/sonde/ch-config/` and adding the
mount to compose:

```bash
cd /opt/sonde && docker compose up -d clickhouse  # recreates container, ~10s
```

Then verify:

```bash
docker exec sonde-clickhouse-1 cat /etc/clickhouse-server/config.d/sonde-overrides.xml
docker exec sonde-clickhouse-1 clickhouse-client --query "SELECT 1"  # alive?
```

## Why not commit `/opt/sonde/docker-compose.yml` to this repo too?

Tracked-on-list. Compose lives at `/opt/sonde/` because the original
bootstrap put it there before this repo existed. Moving it into
`infra/hetzner-compose/` is a Phase 2 cleanup (when the app moves to
the box and we're already touching deploy topology).
