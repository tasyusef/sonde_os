/**
 * Every NFTokenID an NFT transaction is about, in first-seen order.
 *
 * Sources, most direct first:
 *  - `tx.NFTokenID` (NFTokenCreateOffer, NFTokenBurn, NFTokenModify)
 *  - `meta.nftoken_id` (NFTokenMint, NFTokenAcceptOffer)
 *  - `meta.nftoken_ids` (NFTokenCancelOffer)
 *  - NFTokenOffer nodes in `meta.AffectedNodes`, which also cover servers
 *    that predate the synthetic `nftoken_id(s)` fields
 *
 * IDs are uppercased so the same token found twice is listed once.
 */

const NFTOKEN_ID_RE = /^[A-Fa-f0-9]{64}$/;

type Node = {
  LedgerEntryType?: string;
  NewFields?: Record<string, unknown>;
  FinalFields?: Record<string, unknown>;
};

export function findNftokenIds(tx: Record<string, unknown>): string[] {
  const meta = (tx.meta ?? tx.metaData) as
    | {
        nftoken_id?: unknown;
        nftoken_ids?: unknown;
        AffectedNodes?: Array<Record<string, Node | undefined>>;
      }
    | undefined;

  const candidates: unknown[] = [tx.NFTokenID, meta?.nftoken_id];
  if (Array.isArray(meta?.nftoken_ids)) candidates.push(...meta.nftoken_ids);

  for (const entry of meta?.AffectedNodes ?? []) {
    const node = entry.CreatedNode ?? entry.ModifiedNode ?? entry.DeletedNode;
    if (node?.LedgerEntryType !== "NFTokenOffer") continue;
    candidates.push(node.NewFields?.NFTokenID ?? node.FinalFields?.NFTokenID);
  }

  const ids = new Set<string>();
  for (const c of candidates) {
    if (typeof c === "string" && NFTOKEN_ID_RE.test(c)) ids.add(c.toUpperCase());
  }
  return [...ids];
}
