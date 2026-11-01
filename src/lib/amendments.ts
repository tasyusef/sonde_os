/**
 * Amendment status from two node sources, merged:
 *   - `feature`: names, enabled flag and (when the node reports them)
 *     validator vote counts. Public nodes omit the counts.
 *   - the Amendments ledger entry: the authoritative enabled set and
 *     which pending amendments currently hold a majority, since when.
 * Either one alone is enough to render the list. Votes on public nodes
 * come from a vote service instead (`amendment-votes.ts`), laid over
 * the rows by `applyTally`. Activation dates come from the static
 * registry in `xrpl-amendments.ts` (the ledger doesn't record them),
 * then the vote service.
 */

import { activationFromMajority, neededVotes, type VoteTally } from "./amendment-votes";
import { AMENDMENT_ACTIVATION } from "./xrpl-amendments";
import type { FeatureResponse } from "@/types/xrpl-responses";
import type { AmendmentInfo, AmendmentsLedgerEntry } from "@/types/amendments";

/** Well-known index of the Amendments singleton ledger entry. */
export const AMENDMENTS_OBJECT_INDEX =
  "7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4";

/** Registry lookups keyed by amendment ID. */
const REGISTRY = new Map(
  Object.entries(AMENDMENT_ACTIVATION).map(([name, entry]) => [
    entry.id,
    { name, activationDate: entry.activationDate },
  ]),
);

/** Merges the two sources into one row per amendment. */
export function mergeAmendments(
  features: FeatureResponse | null,
  entry: AmendmentsLedgerEntry | null,
): AmendmentInfo[] {
  const enabledSet = new Set(entry?.Amendments ?? []);
  const majoritySince = new Map(
    (entry?.Majorities ?? []).map((m) => [m.Majority.Amendment, m.Majority.CloseTime]),
  );
  const hashes = new Set([
    ...Object.keys(features ?? {}),
    ...enabledSet,
    ...majoritySince.keys(),
  ]);

  return [...hashes].map((hash) => {
    const info = features?.[hash];
    const known = REGISTRY.get(hash);
    const enabled = enabledSet.has(hash) || (info?.enabled ?? false);
    const since = majoritySince.get(hash);
    const { count, threshold, validations } = info ?? {};
    return {
      hash,
      name: info?.name || known?.name || hash,
      enabled,
      enabledAt: enabled && known?.activationDate ? known.activationDate : null,
      hasMajority: since != null,
      activatesAt: since != null ? activationFromMajority(since) : null,
      votes:
        count != null && threshold != null && validations
          ? { yes: count, of: validations, needed: neededVotes(threshold, validations) }
          : null,
    };
  });
}

/**
 * Lays a vote service's tally over the node's rows: votes on every open
 * amendment (none counted means none cast), names and dates the node
 * and registry lack, and open amendments the node doesn't know yet.
 */
export function applyTally(rows: AmendmentInfo[], tally: VoteTally): AmendmentInfo[] {
  const known = new Set(rows.map((r) => r.hash));
  const unknown: AmendmentInfo[] = Object.keys(tally.yes)
    .filter((hash) => !known.has(hash))
    .map((hash) => ({
      hash,
      name: hash,
      enabled: false,
      enabledAt: null,
      hasMajority: false,
      activatesAt: null,
      votes: null,
    }));

  return [...rows, ...unknown].map((row) => {
    const name = row.name === row.hash ? (tally.names[row.hash] ?? row.name) : row.name;
    if (row.enabled) {
      return { ...row, name, enabledAt: row.enabledAt ?? tally.enabledOn[row.hash] ?? null };
    }
    const activatesAt = row.activatesAt ?? tally.activates[row.hash] ?? null;
    return {
      ...row,
      name,
      hasMajority: row.hasMajority || activatesAt != null,
      activatesAt,
      votes: { yes: tally.yes[row.hash] ?? 0, of: tally.unl, needed: tally.needed },
    };
  });
}

/**
 * Splits rows into the amendments being voted on (closest to activating
 * first), open ones no UNL validator votes for (retired, or never taken
 * up), and enabled ones (newest first). Without votes, every open
 * amendment counts as being voted on: there's no telling them apart.
 */
export function groupAmendments(rows: AmendmentInfo[]) {
  const voting: AmendmentInfo[] = [];
  const idle: AmendmentInfo[] = [];
  const enabled: AmendmentInfo[] = [];
  for (const row of rows) {
    if (row.enabled) enabled.push(row);
    else if (!row.votes || row.votes.yes > 0 || row.hasMajority) voting.push(row);
    else idle.push(row);
  }
  const byName = (a: AmendmentInfo, b: AmendmentInfo) => a.name.localeCompare(b.name);
  voting.sort(
    (a, b) =>
      Number(b.hasMajority) - Number(a.hasMajority) ||
      (b.votes?.yes ?? 0) - (a.votes?.yes ?? 0) ||
      byName(a, b),
  );
  idle.sort(byName);
  // ISO dates sort as strings; undated ones go last.
  enabled.sort((a, b) => (b.enabledAt ?? "").localeCompare(a.enabledAt ?? "") || byName(a, b));
  return { voting, idle, enabled };
}
