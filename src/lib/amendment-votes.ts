/**
 * Validator votes on open amendments. Public nodes leave the counts out
 * of `feature`, and a validator only restates its votes on a flag
 * ledger, so Sonde reads a service that already tallies them:
 * data.xrpl.org (the XRPL Foundation's validator history), with XRPScan
 * as the backup. Both count only validators on the default UNL.
 */

import { XRPL_EPOCH } from "./xrpl-helpers";

export const VHS_VOTES_URL = "https://data.xrpl.org/v1/network/amendments/vote/main";
export const XRPSCAN_AMENDMENTS_URL = "https://api.xrpscan.com/api/v1/amendments";

/** How long an amendment must hold a majority before it activates. */
const MAJORITY_SECONDS = 14 * 24 * 60 * 60;

export interface VoteTally {
  source: "data.xrpl.org" | "XRPScan";
  /** Validators on the default UNL. */
  unl: number;
  /** Yes votes an amendment needs to hold a majority. */
  needed: number;
  /** UNL yes votes by amendment ID. Open amendments missing here have none. */
  yes: Record<string, number>;
  /** When each amendment that holds a majority activates (ISO). */
  activates: Record<string, string>;
  /** Every name the source knows, for amendments the node can't name. */
  names: Record<string, string>;
  /** When each enabled amendment activated (ISO); the registry stops
   *  at its last refresh. */
  enabledOn: Record<string, string>;
}

/**
 * Votes needed for a majority, given the node's threshold (80% of the
 * UNL, rounded down). Since fixAmendmentMajorityCalc an amendment needs
 * more votes than the threshold, except on a one-validator UNL.
 */
export function neededVotes(threshold: number, unl: number): number {
  return unl <= 1 ? threshold : threshold + 1;
}

/** A ledger close time (seconds since 2000) at which a majority began
 *  → when that majority activates the amendment (ISO). */
export function activationFromMajority(closeTime: number): string {
  return new Date((closeTime + XRPL_EPOCH + MAJORITY_SECONDS) * 1000).toISOString();
}

/** A date string → ISO, or null when it doesn't parse. */
function iso(value: string | undefined): string | null {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function emptyTally(source: VoteTally["source"]): VoteTally {
  return { source, unl: 0, needed: 0, yes: {}, activates: {}, names: {}, enabledOn: {} };
}

interface VhsAmendment {
  id?: string;
  name?: string;
  obsolete?: boolean;
  retired?: boolean;
  /** "28/35": the threshold over the UNL size. */
  threshold?: string;
  eta?: string;
  /** When it activated, on enabled amendments. */
  date?: string;
  voted?: { validators?: { unl?: unknown }[] };
}

/** data.xrpl.org `/v1/network/amendments/vote/main` → tally. */
export function parseVhsVotes(json: unknown): VoteTally {
  const list = (json as { amendments?: unknown } | null)?.amendments;
  if (!Array.isArray(list)) throw new Error("data.xrpl.org: no amendments");
  const tally = emptyTally("data.xrpl.org");
  for (const a of list as VhsAmendment[]) {
    if (!a?.id) continue;
    const id = a.id.toUpperCase();
    if (a.name) tally.names[id] = a.name;
    // Enabled amendments carry a date instead of votes.
    const enabledOn = a.voted ? null : iso(a.date);
    if (enabledOn) tally.enabledOn[id] = enabledOn;
    // Obsolete ones include a test fake.
    if (!a.voted || a.obsolete || a.retired) continue;
    const [threshold, unl] = (a.threshold ?? "").split("/").map(Number);
    if (!(unl > 0) || !Number.isInteger(threshold)) continue;
    tally.unl = unl;
    tally.needed = neededVotes(threshold, unl);
    tally.yes[id] = (a.voted.validators ?? []).filter((v) => v?.unl).length;
    const eta = iso(a.eta);
    if (eta) tally.activates[id] = eta;
  }
  return tally;
}

interface XrpscanAmendment {
  amendment_id?: string;
  name?: string;
  enabled?: boolean;
  deprecated?: boolean;
  count?: number;
  threshold?: number;
  validations?: number;
  /** Close time (seconds since 2000) at which its majority began. */
  majority?: number;
  enabled_on?: string;
}

/** XRPScan `/api/v1/amendments` → tally. */
export function parseXrpscanVotes(json: unknown): VoteTally {
  if (!Array.isArray(json)) throw new Error("XRPScan: no amendments");
  const tally = emptyTally("XRPScan");
  for (const a of json as XrpscanAmendment[]) {
    if (!a?.amendment_id) continue;
    const id = a.amendment_id.toUpperCase();
    if (a.name) tally.names[id] = a.name;
    const enabledOn = a.enabled ? iso(a.enabled_on) : null;
    if (enabledOn) tally.enabledOn[id] = enabledOn;
    if (a.enabled || a.deprecated) continue;
    const { count, threshold, validations } = a;
    if (typeof count !== "number" || typeof threshold !== "number" || !(Number(validations) > 0)) continue;
    tally.unl = validations!;
    tally.needed = neededVotes(threshold, validations!);
    tally.yes[id] = count;
    if (typeof a.majority === "number") tally.activates[id] = activationFromMajority(a.majority);
  }
  return tally;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

/** data.xrpl.org, else XRPScan. Throws when neither answers. */
export async function fetchVoteTally(): Promise<VoteTally> {
  try {
    return parseVhsVotes(await getJson(VHS_VOTES_URL));
  } catch {
    return parseXrpscanVotes(await getJson(XRPSCAN_AMENDMENTS_URL));
  }
}
