#!/bin/sh
# Format, lint and test the relay. Part of `pnpm check`.
set -e
cd "$(dirname "$0")"
command -v cargo >/dev/null 2>&1 || PATH="$(dirname "$(rustup which cargo)"):$PATH"
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo clippy --locked --target wasm32-unknown-unknown -- -D warnings
cargo test --locked --quiet
