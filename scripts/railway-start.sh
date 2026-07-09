#!/usr/bin/env bash
# scripts/railway-start.sh
#
# Railway start command. Pre-Phase-1-cutover: simple passthrough to
# `pnpm start` (DATABASE_URL points at Railway PG via public TLS, no
# tunnel needed). Post-cutover: starts a `cloudflared access tcp`
# sidecar that opens localhost:5432 → $PG_TUNNEL_HOSTNAME:5432
# (gated by Service Token), then runs the app.
#
# Mode is chosen by DATABASE_URL: if it points at localhost or
# 127.0.0.1, we're post-cutover and need the tunnel. Otherwise legacy.
#
# Required env when in tunnel mode:
#   PG_TUNNEL_HOSTNAME
#   CF_ACCESS_CLIENT_ID
#   CF_ACCESS_CLIENT_SECRET
#
# If cloudflared dies mid-flight, `wait -n` exits this script and
# Railway restarts the container. Same for the app process.

set -e

# Nixpacks multi-stage builds don't carry /usr/local/bin into runtime —
# only the project dir (/app) survives. cloudflared is downloaded to
# ./cloudflared during build; add the project dir to PATH so it's findable.
export PATH="$PWD:$PATH"

NEEDS_TUNNEL=0
case "${DATABASE_URL:-}" in
  *@localhost:*|*@127.0.0.1:*) NEEDS_TUNNEL=1 ;;
esac

if [ "$NEEDS_TUNNEL" = "0" ]; then
  echo "[entrypoint] DATABASE_URL is remote — running in legacy mode (no tunnel)"
  exec pnpm start
fi

if [ -z "${CF_ACCESS_CLIENT_ID:-}" ] || [ -z "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  echo "[entrypoint] FATAL: DATABASE_URL points at localhost but CF_ACCESS_CLIENT_ID/SECRET are missing"
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "[entrypoint] FATAL: cloudflared binary not found (PATH=$PATH, PWD=$PWD)"
  ls -la ./cloudflared 2>&1 || true
  exit 1
fi

: "${PG_TUNNEL_HOSTNAME:?PG_TUNNEL_HOSTNAME is required in tunnel mode}"
echo "[entrypoint] starting cloudflared access tcp sidecar ($PG_TUNNEL_HOSTNAME → localhost:5432)"
cloudflared access tcp \
  --hostname "$PG_TUNNEL_HOSTNAME" \
  --url localhost:5432 \
  --loglevel info &
CLOUDFLARED_PID=$!

# Wait up to 30s for cloudflared to be listening on 5432.
echo "[entrypoint] waiting for tunnel listener…"
for i in $(seq 1 30); do
  if (echo > /dev/tcp/localhost/5432) 2>/dev/null; then
    echo "[entrypoint] tunnel listener up after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then
    echo "[entrypoint] FATAL: cloudflared failed to listen within 30s"
    kill "$CLOUDFLARED_PID" 2>/dev/null || true
    exit 1
  fi
done

echo "[entrypoint] starting app (pnpm start)"
pnpm start &
APP_PID=$!

# Wait for whichever exits first; propagate exit code so Railway
# restarts the container.
wait -n "$CLOUDFLARED_PID" "$APP_PID"
EXIT=$?
echo "[entrypoint] subprocess exited (code $EXIT) — terminating siblings"
kill "$CLOUDFLARED_PID" "$APP_PID" 2>/dev/null || true
exit "$EXIT"
