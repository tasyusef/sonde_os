/**
 * Hand-curated token icon URLs.
 *
 * Used as the final fallback after the XLS-26 TOML resolver fails or
 * returns no icon. The audit on 2026-05-08 found that 77% of no-icon
 * tokens have NO Domain field on their issuer — XLS-26 will never
 * resolve them no matter what we do. The remaining 23% have Domains
 * but issuers ship them in messy formats; the parser fixes accompany
 * this file address most of those.
 *
 * Add entries here for tokens that:
 *   - Show up frequently in Sonde's UI (popular by volume / pairs / accounts)
 *   - Don't have an XLS-26 TOML, OR have one without an `icon` field
 *   - Have a recognizable, owner-blessed icon you trust
 *
 * Format:
 *
 *   "{CURRENCY}|{ISSUER}": "https://path/to/icon.png"
 *
 *   - `CURRENCY` matches the on-ledger form: 40-char uppercase hex for
 *     4+-char tickers, 3-char ASCII otherwise. Use the form Sonde
 *     stores in `token_metadata.currency`.
 *   - `ISSUER` is the classic r-address (case-sensitive).
 *   - Icon URLs must be HTTPS and live on a public host (the SSRF gate
 *     in `src/lib/nft-hosts.ts` rejects private IPs / metadata services /
 *     non-HTTPS).
 *
 * The token-icon-resolver writes whichever icon source it finds
 * (XLS-26 wins if both are present) into `token_metadata.icon`.
 */

export const CURATED_TOKEN_ICONS: Record<string, string> = {
  // Examples of the format — uncomment / edit / add as needed:
  // "534F4C4F00000000000000000000000000000000|rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz": "https://example.com/solo.png",
  // "USD|rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq": "https://example.com/gatehub-usd.png",
};

/** Look up a token icon by on-ledger currency + issuer. */
export function getCuratedTokenIcon(
  currency: string,
  issuer: string,
): string | null {
  return CURATED_TOKEN_ICONS[`${currency}|${issuer}`] ?? null;
}
