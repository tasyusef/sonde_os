//! Sonde live relay: one Cloudflare Durable Object holds a single XRPL node
//! connection and sends every visitor a compact snapshot per ledger close,
//! instead of each browser downloading full ledgers itself.
//!
//! The pure modules build natively so `cargo test` needs no Workers runtime.
//! The Durable Object and the Worker entry point only build for wasm.

pub mod ledger_queue;
pub mod nodes;
pub mod price;
pub mod snapshot;

#[cfg(target_arch = "wasm32")]
mod relay;
