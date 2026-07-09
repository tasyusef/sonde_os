/**
 * NFT state extractor — pulls offer + ownership events out of NFT-related
 * transactions and produces rows ready for ClickHouse insertion into
 * `nft_offers` and `nft_ownership`.
 *
 * Handles five tx types:
 *   - NFTokenMint           → NFT created, sets ownership row
 *   - NFTokenBurn           → NFT destroyed, marks ownership.is_burned
 *   - NFTokenCreateOffer    → NFTokenOffer ledger entry created, inserts active offer row
 *   - NFTokenCancelOffer    → entries deleted, writes closed-offer rows
 *   - NFTokenAcceptOffer    → offer entries deleted + NFT changes hands
 *
 * Replaces the per-NFT browser fan-out previously used by the OffersTab
 * Incoming view. Once ingested into CH, "all incoming offers for account X"
 * is a single sub-100ms query — no per-NFT round-trips, no cap.
 *
 * On close events (cancel/accept/burn) we use the DeletedNode's
 * `PreviousTxnLgrSeq` as the offer's `created_ledger`. We don't have the
 * exact create timestamp without a lookup, so we set
 * `created_timestamp = closed_timestamp` on close-only rows. Active
 * offers carry the correct create timestamp from the create event. Since
 * all consumer queries filter for active offers (`closed_ledger = 0`),
 * the small loss of metadata on closed rows doesn't affect any current
 * query path.
 *
 * The `nft_offers` table is `ReplacingMergeTree(last_updated)` keyed on
 * `nft_offer_index`. When the same offer is touched twice (create then
 * close), the close row's higher `last_updated` wins after merge —
 * the row carries the close fields.
 */

// No `server-only` import — this module is a pure extractor that the
// backfill script (`scripts/backfill-nft-state.ts`) imports via tsx,
// outside the Next.js runtime. A `server-only` marker would throw at
// the top of that script. The extractor doesn't touch server-only
// resources (no fs, no env, no DB) so the marker isn't needed for
// safety either.
import type {
  RawLedgerTx,
  AffectedNode,
  CurrencyAmount,
} from "@/types/ingestion";
import { parseNFTokenID } from "@/lib/nft-parsing";

/** XRPL epoch offset — seconds between Unix epoch and 2000-01-01 UTC. */
const XRPL_EPOCH_OFFSET_S = 946_684_800;

/** lsfSellNFToken — set on NFTokenOffer entries that are sell offers. */
const LSF_SELL_NFTOKEN = 0x00000001;

export interface NftOfferRow extends Record<string, unknown> {
  nft_offer_index: string;
  nft_id: string;
  owner: string;
  amount_drops: string;
  amount_iou: string;
  currency: string;
  issuer: string;
  destination: string;
  /** XRPL Expiration field — seconds since 2000-01-01 UTC. 0 = no expiry. */
  expiration_xrpl: number;
  flags: number;
  created_ledger: number;
  /** CH `DateTime` literal `YYYY-MM-DD HH:MM:SS` (seconds resolution). */
  created_timestamp: string;
  /** 0 = still active. > 0 = ledger this offer was closed in. */
  closed_ledger: number;
  /** Same format as `created_timestamp`. `'1970-01-01 00:00:00'` when active. */
  closed_timestamp: string;
  closed_reason: "" | "cancelled" | "accepted" | "burned" | "expired";
}

export interface NftOwnershipRow extends Record<string, unknown> {
  nft_id: string;
  owner: string;
  acquired_ledger: number;
  acquired_tx_hash: string;
  acquired_timestamp: string;
  is_burned: number;
}

/** Set-once-at-mint metadata. Lives in `nft_static_metadata` so the
 *  immutable fields (URI, issuer, taxon, mint info) don't get clobbered
 *  by `nft_ownership`'s ReplacingMergeTree on transfers. URIs are
 *  immutable per XLS-20 — once set at mint, they never change. */
export interface NftStaticMetadataRow extends Record<string, unknown> {
  nft_id: string;
  /** Hex-encoded URI exactly as supplied to the NFTokenMint tx. Empty
   *  for NFTs minted without a URI, and also for "speculative" rows
   *  seeded by non-mint paths (transfer / burn / offer-create) where
   *  we never saw the original mint event. */
  uri: string;
  issuer: string;
  taxon: number;
  minted_ledger: number;
  minted_timestamp: string;
  /** Optional explicit `last_updated`. Omit for real mint rows (CH
   *  defaults to `now()`). Set to `NULL_DATETIME` for speculative seeds
   *  from non-mint paths — that way any real mint event for the same
   *  `nft_id` always wins under `ReplacingMergeTree(last_updated)`
   *  merges, regardless of arrival order. */
  last_updated?: string;
}

/** Result bundle returned by `extractNftStateEvents` per tx. */
export interface NftStateEvents {
  offers: NftOfferRow[];
  ownership: NftOwnershipRow[];
  staticMetadata: NftStaticMetadataRow[];
}

/** Convert a JS Date to CH-friendly `YYYY-MM-DD HH:MM:SS` UTC. */
function toCHDateTime(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

/** Convert XRPL `date` (seconds since 2000-01-01 UTC) to CH DateTime. */
function xrplDateToCHDateTime(xrplDate: number): string {
  return toCHDateTime(new Date((xrplDate + XRPL_EPOCH_OFFSET_S) * 1000));
}

/** Sentinel CH DateTime — `1970-01-01 00:00:00` (Unix epoch). */
const NULL_DATETIME = "1970-01-01 00:00:00";

/**
 * Build a "speculative" static-metadata row from a NFTokenID alone.
 * Used by non-mint paths (NFTokenAcceptOffer, NFTokenBurn,
 * NFTokenCreateOffer) so collections whose mint event predates our
 * ingestion window still get a metadata row keyed on the nft_id —
 * critical for the daily collection snapshotter's INNER JOIN to
 * register `holder_count` / `listing_count` for those collections,
 * and for the listings query to count the listing under the right
 * (issuer, taxon) collection.
 *
 * URI is unrecoverable here (only the mint tx body carries it), so
 * we write empty. We tag the row with `last_updated = NULL_DATETIME`
 * so a real mint event for the same `nft_id` — whether processed
 * before or after this seed — always wins under the table's
 * `ReplacingMergeTree(last_updated)` merges.
 *
 * Returns null for malformed nft_ids (shouldn't occur in practice —
 * `findMintedNftId` / `findDeletedNFTokenOffers` validate before
 * reaching here — but defense in depth).
 */
function seedMetadataFromNftId(
  nftId: string,
  ledgerIndex: number,
  txTimestamp: string,
): NftStaticMetadataRow | null {
  const parsed = parseNFTokenID(nftId);
  if (!parsed) return null;
  return {
    nft_id: nftId,
    uri: "",
    issuer: parsed.issuer,
    taxon: parsed.nft_taxon,
    minted_ledger: ledgerIndex,
    minted_timestamp: txTimestamp,
    last_updated: NULL_DATETIME,
  };
}

/* ------------------------------------------------------------------ */
/*  Amount parsing — XRP drops vs IOU                                   */
/* ------------------------------------------------------------------ */

interface ParsedAmount {
  amount_drops: string;
  amount_iou: string;
  currency: string;
  issuer: string;
}

function parseAmount(amount: unknown): ParsedAmount {
  if (typeof amount === "string") {
    return {
      amount_drops: amount,
      amount_iou: "",
      currency: "XRP",
      issuer: "",
    };
  }
  if (amount && typeof amount === "object" && "value" in amount) {
    const c = amount as CurrencyAmount;
    return {
      amount_drops: "0",
      amount_iou: c.value,
      currency: c.currency,
      issuer: c.issuer,
    };
  }
  return {
    amount_drops: "0",
    amount_iou: "",
    currency: "XRP",
    issuer: "",
  };
}

/* ------------------------------------------------------------------ */
/*  AffectedNodes scanners                                              */
/* ------------------------------------------------------------------ */

interface CreatedNFTokenOffer {
  index: string;
  fields: Record<string, unknown>;
}

function findCreatedNFTokenOffers(
  nodes: AffectedNode[],
): CreatedNFTokenOffer[] {
  const out: CreatedNFTokenOffer[] = [];
  for (const node of nodes) {
    const c = node.CreatedNode;
    if (!c || c.LedgerEntryType !== "NFTokenOffer") continue;
    if (!c.LedgerIndex || !c.NewFields) continue;
    out.push({ index: c.LedgerIndex, fields: c.NewFields });
  }
  return out;
}

interface DeletedNFTokenOffer {
  index: string;
  fields: Record<string, unknown>;
  previousTxnLgrSeq: number;
}

function findDeletedNFTokenOffers(
  nodes: AffectedNode[],
): DeletedNFTokenOffer[] {
  const out: DeletedNFTokenOffer[] = [];
  for (const node of nodes) {
    const d = node.DeletedNode;
    if (!d || d.LedgerEntryType !== "NFTokenOffer") continue;
    if (!d.LedgerIndex || !d.FinalFields) continue;
    out.push({
      index: d.LedgerIndex,
      fields: d.FinalFields,
      previousTxnLgrSeq: d.PreviousTxnLgrSeq ?? 0,
    });
  }
  return out;
}

/** Find the NFTokenID of an NFT minted in this tx via the NFTokenPage
 *  CreatedNode/ModifiedNode entries. The convenience `meta.nftoken_id`
 *  is preferred when rippled supplies it; falls back to AffectedNodes
 *  when not. */
function findMintedNftId(tx: RawLedgerTx): string | null {
  const meta = tx.meta ?? tx.metaData;
  if (meta?.nftoken_id) return meta.nftoken_id;

  // Walk NFTokenPage NewFields/PreviousFields diff to find the new NFT.
  // NFTokenPages are doubly-linked lists; the mint adds an NFToken object
  // to the owner's page. The new NFTokenID isn't always at a fixed slot,
  // so we scan all NFToken arrays and look for one not present in
  // PreviousFields.
  const nodes = meta?.AffectedNodes ?? [];
  for (const node of nodes) {
    const created = node.CreatedNode;
    if (created?.LedgerEntryType === "NFTokenPage") {
      const tokens = (
        created.NewFields?.NFTokens as
          | Array<{ NFToken?: { NFTokenID?: string } }>
          | undefined
      ) ?? [];
      if (tokens.length > 0) {
        const id = tokens[0].NFToken?.NFTokenID;
        if (id) return id;
      }
    }
    const modified = node.ModifiedNode;
    if (modified?.LedgerEntryType === "NFTokenPage") {
      const after = (
        modified.FinalFields?.NFTokens as
          | Array<{ NFToken?: { NFTokenID?: string } }>
          | undefined
      ) ?? [];
      const before = (
        modified.PreviousFields?.NFTokens as
          | Array<{ NFToken?: { NFTokenID?: string } }>
          | undefined
      ) ?? [];
      const beforeIds = new Set(
        before.map((t) => t.NFToken?.NFTokenID).filter(Boolean) as string[],
      );
      for (const t of after) {
        const id = t.NFToken?.NFTokenID;
        if (id && !beforeIds.has(id)) return id;
      }
    }
  }
  return null;
}

/** Find the NFTokenID burned in an NFTokenBurn tx. The tx body carries
 *  it directly. */
function findBurnedNftId(tx: RawLedgerTx): string | null {
  const id = (tx as unknown as { NFTokenID?: string }).NFTokenID;
  return id ?? null;
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Pull offer + ownership + static-metadata events out of a single
 * transaction. Returns empty arrays for non-NFT tx types or failed
 * transactions.
 */
export function extractNftStateEvents(tx: RawLedgerTx): NftStateEvents {
  const offers: NftOfferRow[] = [];
  const ownership: NftOwnershipRow[] = [];
  const staticMetadata: NftStaticMetadataRow[] = [];

  const meta = tx.meta ?? tx.metaData;
  if (!meta || meta.TransactionResult !== "tesSUCCESS") {
    return { offers, ownership, staticMetadata };
  }
  if (!tx.ledger_index || !tx.date || !tx.hash) {
    return { offers, ownership, staticMetadata };
  }

  const ledgerIndex = tx.ledger_index;
  const txTimestamp = xrplDateToCHDateTime(tx.date);
  const txHash = tx.hash;
  const nodes = meta.AffectedNodes ?? [];

  switch (tx.TransactionType) {
    case "NFTokenCreateOffer": {
      // CreatedNode entries are the new offers (usually one).
      const created = findCreatedNFTokenOffers(nodes);
      for (const c of created) {
        const f = c.fields;
        const amount = parseAmount(f.Amount);
        const nftId = String(f.NFTokenID ?? "");
        offers.push({
          nft_offer_index: c.index,
          nft_id: nftId,
          owner: String(f.Owner ?? tx.Account ?? ""),
          amount_drops: amount.amount_drops,
          amount_iou: amount.amount_iou,
          currency: amount.currency,
          issuer: amount.issuer,
          destination: String(f.Destination ?? ""),
          expiration_xrpl: Number(f.Expiration ?? 0),
          flags: Number(f.Flags ?? 0),
          created_ledger: ledgerIndex,
          created_timestamp: txTimestamp,
          closed_ledger: 0,
          closed_timestamp: NULL_DATETIME,
          closed_reason: "",
        });
        // Seed speculative metadata so the listings query can map this
        // offer to its collection even if we never saw the original
        // mint (e.g. NFT minted before our ingestion window).
        if (nftId) {
          const seed = seedMetadataFromNftId(nftId, ledgerIndex, txTimestamp);
          if (seed) staticMetadata.push(seed);
        }
      }
      break;
    }

    case "NFTokenCancelOffer": {
      // DeletedNode entries are the cancelled offers.
      const deleted = findDeletedNFTokenOffers(nodes);
      for (const d of deleted) {
        const f = d.fields;
        const amount = parseAmount(f.Amount);
        offers.push({
          nft_offer_index: d.index,
          nft_id: String(f.NFTokenID ?? ""),
          owner: String(f.Owner ?? ""),
          amount_drops: amount.amount_drops,
          amount_iou: amount.amount_iou,
          currency: amount.currency,
          issuer: amount.issuer,
          destination: String(f.Destination ?? ""),
          expiration_xrpl: Number(f.Expiration ?? 0),
          flags: Number(f.Flags ?? 0),
          created_ledger: d.previousTxnLgrSeq,
          created_timestamp: txTimestamp,
          closed_ledger: ledgerIndex,
          closed_timestamp: txTimestamp,
          closed_reason: "cancelled",
        });
      }
      break;
    }

    case "NFTokenAcceptOffer": {
      // DeletedNode entries are the accepted offers (1 direct, 2 brokered).
      const deleted = findDeletedNFTokenOffers(nodes);
      let nftId: string | null = meta.nftoken_id ?? null;
      let newOwner: string | null = null;

      const isBrokered =
        Boolean(
          (tx as unknown as { NFTokenSellOffer?: string }).NFTokenSellOffer,
        ) &&
        Boolean(
          (tx as unknown as { NFTokenBuyOffer?: string }).NFTokenBuyOffer,
        );

      for (const d of deleted) {
        const f = d.fields;
        const amount = parseAmount(f.Amount);
        const flags = Number(f.Flags ?? 0);
        const isSell = (flags & LSF_SELL_NFTOKEN) !== 0;
        if (!nftId) nftId = String(f.NFTokenID ?? "") || null;
        // Determine new owner from offer side:
        //  - Direct: accept-sell → tx.Account becomes owner; accept-buy →
        //    offer's Owner becomes owner.
        //  - Brokered: the buy offer's Owner becomes the new owner.
        if (isBrokered) {
          if (!isSell) newOwner = String(f.Owner ?? "");
        } else {
          newOwner = isSell ? tx.Account : String(f.Owner ?? "");
        }

        offers.push({
          nft_offer_index: d.index,
          nft_id: String(f.NFTokenID ?? ""),
          owner: String(f.Owner ?? ""),
          amount_drops: amount.amount_drops,
          amount_iou: amount.amount_iou,
          currency: amount.currency,
          issuer: amount.issuer,
          destination: String(f.Destination ?? ""),
          expiration_xrpl: Number(f.Expiration ?? 0),
          flags,
          created_ledger: d.previousTxnLgrSeq,
          created_timestamp: txTimestamp,
          closed_ledger: ledgerIndex,
          closed_timestamp: txTimestamp,
          closed_reason: "accepted",
        });
      }

      // Ownership transfer — only if we resolved both NFT id and new owner.
      if (nftId && newOwner) {
        ownership.push({
          nft_id: nftId,
          owner: newOwner,
          acquired_ledger: ledgerIndex,
          acquired_tx_hash: txHash,
          acquired_timestamp: txTimestamp,
          is_burned: 0,
        });
        // Seed speculative metadata so the snapshotter can map this
        // ownership to its (issuer, taxon) collection even if we never
        // saw the original mint. Wins by mint if the mint is ever
        // processed (mint emits `last_updated = now()`, this emits
        // NULL_DATETIME).
        const seed = seedMetadataFromNftId(nftId, ledgerIndex, txTimestamp);
        if (seed) staticMetadata.push(seed);
      }
      break;
    }

    case "NFTokenMint": {
      const nftId = findMintedNftId(tx);
      if (nftId) {
        ownership.push({
          nft_id: nftId,
          owner: tx.Account,
          acquired_ledger: ledgerIndex,
          acquired_tx_hash: txHash,
          acquired_timestamp: txTimestamp,
          is_burned: 0,
        });
        // Emit a static-metadata row alongside the ownership row.
        // URI is hex-encoded directly on the tx body; issuer + taxon
        // are decoded from the nft_id. NFTs can mint without a URI
        // (the field is optional) — we store an empty string then.
        const parsed = parseNftIdInline(nftId);
        const txWithFields = tx as unknown as {
          URI?: string;
          Issuer?: string;
          NFTokenTaxon?: number;
        };
        staticMetadata.push({
          nft_id: nftId,
          uri: typeof txWithFields.URI === "string" ? txWithFields.URI : "",
          // Mint may set `Issuer` (delegated mint) or default to `tx.Account`.
          issuer: txWithFields.Issuer ?? tx.Account,
          taxon: parsed?.taxon ?? Number(txWithFields.NFTokenTaxon ?? 0),
          minted_ledger: ledgerIndex,
          minted_timestamp: txTimestamp,
        });
      }
      break;
    }

    case "NFTokenBurn": {
      const nftId = findBurnedNftId(tx);
      if (nftId) {
        ownership.push({
          nft_id: nftId,
          // Owner is whoever held it pre-burn; the tx's Account is the
          // burner (issuer for issuer-burns or the holder otherwise).
          // For state purposes we just need is_burned = 1.
          owner: tx.Account,
          acquired_ledger: ledgerIndex,
          acquired_tx_hash: txHash,
          acquired_timestamp: txTimestamp,
          is_burned: 1,
        });
        // Seed metadata so historical pages can still resolve this
        // burned NFT's collection. Mint-event row wins if we ever
        // processed it (NULL_DATETIME < now() on merge).
        const seed = seedMetadataFromNftId(nftId, ledgerIndex, txTimestamp);
        if (seed) staticMetadata.push(seed);
        // Mark all open offers on this NFT as closed-by-burn. We don't
        // know which offers exist without a lookup; leave that as a
        // periodic cleanup or rely on the natural CH dedup when those
        // offer entries get DeletedNode'd in the same tx (they should
        // all be deleted as side-effects of NFTokenBurn).
        const deleted = findDeletedNFTokenOffers(nodes);
        for (const d of deleted) {
          const f = d.fields;
          const amount = parseAmount(f.Amount);
          offers.push({
            nft_offer_index: d.index,
            nft_id: String(f.NFTokenID ?? nftId),
            owner: String(f.Owner ?? ""),
            amount_drops: amount.amount_drops,
            amount_iou: amount.amount_iou,
            currency: amount.currency,
            issuer: amount.issuer,
            destination: String(f.Destination ?? ""),
            expiration_xrpl: Number(f.Expiration ?? 0),
            flags: Number(f.Flags ?? 0),
            created_ledger: d.previousTxnLgrSeq,
            created_timestamp: txTimestamp,
            closed_ledger: ledgerIndex,
            closed_timestamp: txTimestamp,
            closed_reason: "burned",
          });
        }
      }
      break;
    }
  }

  return { offers, ownership, staticMetadata };
}

/** Inline taxon decoder — local to this module so we don't import the
 *  client-side `parseNFTokenID` (works fine, just keeps imports tight).
 *  Mirrors the same descrambling logic. */
function parseNftIdInline(
  nftId: string,
): { taxon: number; serial: number } | null {
  if (!/^[A-Fa-f0-9]{64}$/.test(nftId)) return null;
  try {
    const scrambled = parseInt(nftId.slice(48, 56), 16) >>> 0;
    const serial = parseInt(nftId.slice(56, 64), 16) >>> 0;
    const scramble = Number(
      (BigInt(384160001) * BigInt(serial) + 2459n) & 0xffffffffn,
    );
    const taxon = (scrambled ^ scramble) >>> 0;
    return { taxon, serial };
  } catch {
    return null;
  }
}
