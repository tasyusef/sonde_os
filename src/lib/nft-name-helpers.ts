/** NFT name helpers: collection names from per-NFT names. No I/O. */

/** Strip trailing "#123", " - #123", " | 123" etc. to get a collection
 *  name. Falls back to the input unchanged when no trailing index
 *  pattern is present — combine with `pickCollectionName` for consensus
 *  when applying across a multi-NFT group. */
export function extractCollectionName(name: string): string {
  return (
    name.replace(/\s*[-–—|:·]?\s*#?\d+\s*$/u, "").trim() || name
  );
}

/**
 * Resolve the consensus collection name across a list of per-NFT names.
 *
 * Why not just first-NFT-wins (the prior approach): when a representative
 * NFT happens to have a unique title rather than a "{Collection} #{N}"
 * pattern, the entire collection inherited that NFT's individual name.
 * Real example: a "Monkey Phunks" collection with one NFT titled
 * "Timmy Cormier" got mislabeled as "Timmy Cormier" in the UI because
 * `extractCollectionName("Timmy Cormier")` returns the input unchanged.
 *
 * Strategy: run `extractCollectionName` over every input, tally the
 * candidates, pick the one with strict majority (> 50% of non-null
 * inputs). Outliers can't override the rest of the collection.
 * Returns `null` when no candidate has majority — caller falls back to
 * "Collection #{taxon}" or similar.
 *
 * Single-sample handling (the "894" bug): when only one NFT has
 * resolved metadata for the collection, accepting its name as the
 * collection name is dangerous — the NFT might literally be named
 * "894" or "Salvador", neither of which is a collection name. We only
 * trust a single sample when `extractCollectionName` actually
 * stripped a numbering suffix (so we know the result is a
 * collection-level prefix, not a one-off title). Otherwise null.
 *
 * Edge cases:
 *   - Empty input → null
 *   - Single sample with "Foo #45" → "Foo" (suffix stripped)
 *   - Single sample with "894" or "Salvador" → null (no pattern, untrustworthy)
 *   - 2-sample input with two different stripped roots → null (no majority)
 *   - All NFTs share the same name (no #N suffix) with N > 1 → that name wins
 */
export function pickCollectionName(
  names: Array<string | null | undefined>,
): string | null {
  const tally = new Map<string, number>();
  let total = 0;
  let strippedCount = 0;
  for (const n of names) {
    if (typeof n !== "string" || !n) continue;
    const candidate = extractCollectionName(n);
    if (!candidate) continue;
    if (candidate !== n) strippedCount += 1;
    tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return null;
  let bestName: string | null = null;
  let bestCount = 0;
  for (const [name, count] of tally) {
    if (count > bestCount) {
      bestName = name;
      bestCount = count;
    }
  }
  if (!bestName) return null;
  // Single-sample: only trust the result when we stripped a pattern.
  // Caught the rPpQL/8888 → "894" mislabel after the gateway expansion
  // landed only one NFT's metadata for that collection.
  if (total === 1) {
    return strippedCount > 0 ? bestName : null;
  }
  // Multi-sample: strict majority. count * 2 > total.
  return bestCount * 2 > total ? bestName : null;
}
