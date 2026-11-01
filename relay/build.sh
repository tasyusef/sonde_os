#!/bin/sh
# Builds the relay into ./build. Run by wrangler (see wrangler.toml).
# worker-build is pinned and installed into ./.tools, not globally.
set -e
cd "$(dirname "$0")"
# Homebrew's rustup doesn't put cargo on PATH; fall back to its toolchain.
command -v cargo >/dev/null 2>&1 || PATH="$(dirname "$(rustup which cargo)"):$PATH"
if [ ! -x .tools/bin/worker-build ]; then
  cargo install --quiet --locked --root .tools worker-build --version 0.8.7
fi
exec .tools/bin/worker-build --release
