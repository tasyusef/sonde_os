//! Public XRPL nodes and the failover rules, the same rules as `src/lib/xrpl-socket.ts`.

/// In preference order. The relay connects to the first one that isn't benched.
/// xrplcluster is last: Workers share egress IPs, so its per-IP rate limit
/// refused the relay all through the 2026-10-29 soak. honeycluster is the
/// non-Ripple backup, but expanded ledgers take it 1–3 s, so it can't lead.
pub const NODES: [&str; 4] = [
    "wss://s2.ripple.com",
    "wss://s1.ripple.com",
    "wss://honeycluster.io",
    "wss://xrplcluster.com",
];

/// Bench length when a rate-limit reply carries no "retry in" hint.
pub const RATE_LIMIT_COOLDOWN_MS: u64 = 60_000;
const MIN_COOLDOWN_MS: u64 = 1_000;
const MAX_COOLDOWN_MS: u64 = 120_000;
const BASE_RECONNECT_DELAY_MS: u64 = 1_000;
const MAX_RECONNECT_DELAY_MS: u64 = 30_000;

/// `slowDown` / `tooBusy`: the node wants us to back off.
pub fn is_rate_limit(error: &str) -> bool {
    matches!(error, "slowDown" | "tooBusy")
}

/// How long to bench a node that rate-limited us. Reads the node's hint
/// (`retry in ~45189ms`, the regex `/retry in ~?(\d+)\s*ms/i`) and clamps it.
pub fn rate_limit_cooldown_ms(error_message: &str) -> u64 {
    let ms = retry_hint_ms(error_message).unwrap_or(RATE_LIMIT_COOLDOWN_MS);
    ms.clamp(MIN_COOLDOWN_MS, MAX_COOLDOWN_MS)
}

fn retry_hint_ms(message: &str) -> Option<u64> {
    const NEEDLE: &str = "retry in ";
    let lower = message.to_ascii_lowercase();
    let mut from = 0;
    while let Some(found) = lower[from..].find(NEEDLE) {
        let start = from + found + NEEDLE.len();
        from = start;
        let rest = lower[start..].strip_prefix('~').unwrap_or(&lower[start..]);
        let digits_len = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits_len == 0 {
            continue;
        }
        if rest[digits_len..].trim_start().starts_with("ms") {
            // Saturate absurd hints instead of failing; the clamp caps them anyway.
            return Some(rest[..digits_len].parse().unwrap_or(u64::MAX));
        }
    }
    None
}

/// Delay before reconnect attempt `attempt + 1`: 1 s doubling to 30 s.
pub fn reconnect_delay_ms(attempt: u32) -> u64 {
    BASE_RECONNECT_DELAY_MS
        .saturating_mul(1 << attempt.min(16))
        .min(MAX_RECONNECT_DELAY_MS)
}

/// The first node not benched at `now`, or how long until one is free.
pub fn pick_node(benched_until: &[u64], now: u64) -> Result<usize, u64> {
    match benched_until.iter().position(|until| *until <= now) {
        Some(index) => Ok(index),
        None => Err(benched_until.iter().min().map_or(0, |until| until - now)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_rate_limit_errors() {
        assert!(is_rate_limit("slowDown"));
        assert!(is_rate_limit("tooBusy"));
        assert!(!is_rate_limit("txnNotFound"));
    }

    #[test]
    fn reads_the_retry_hint() {
        assert_eq!(
            rate_limit_cooldown_ms("You are placing too much load. Retry in ~45189ms."),
            45_189
        );
        // xrplcluster's wording.
        assert_eq!(
            rate_limit_cooldown_ms(
                "rate limit: units quota (10000 per 60s) exhausted, retry in ~45189ms"
            ),
            45_189
        );
        assert_eq!(rate_limit_cooldown_ms("retry in 2500 ms"), 2_500);
        assert_eq!(
            rate_limit_cooldown_ms("retry in soon; retry in ~3000ms"),
            3_000
        );
        assert_eq!(
            rate_limit_cooldown_ms("too much load"),
            RATE_LIMIT_COOLDOWN_MS
        );
        assert_eq!(rate_limit_cooldown_ms("retry in ~5ms"), 1_000);
        assert_eq!(
            rate_limit_cooldown_ms("retry in ~999999999999999999999999ms"),
            120_000
        );
        // The regex needs exactly one space after "in".
        assert_eq!(
            rate_limit_cooldown_ms("retry in  4000ms"),
            RATE_LIMIT_COOLDOWN_MS
        );
    }

    #[test]
    fn reconnect_backoff_caps_at_30s() {
        assert_eq!(reconnect_delay_ms(0), 1_000);
        assert_eq!(reconnect_delay_ms(3), 8_000);
        assert_eq!(reconnect_delay_ms(5), 30_000);
        assert_eq!(reconnect_delay_ms(u32::MAX), 30_000);
    }

    #[test]
    fn picks_the_first_free_node() {
        assert_eq!(pick_node(&[0, 0, 0, 0], 100), Ok(0));
        assert_eq!(pick_node(&[500, 0, 0, 0], 100), Ok(1));
        assert_eq!(pick_node(&[500, 300, 900, 700], 100), Err(200));
    }
}
