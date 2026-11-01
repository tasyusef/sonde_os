import AddressLink from "@/components/shared/AddressLink";
import { decodeCurrency, dropsToXrp } from "@/lib/xrpl-helpers";
import { hexToUtf8 } from "@/lib/hex";
import NftLinks from "./NftLinks";
import { findNftokenIds } from "./nftoken-ids";

interface TxData {
  [key: string]: unknown;
  TransactionType: string;
}

function formatXrpOrToken(amt: unknown): string {
  if (typeof amt === "string") return `${dropsToXrp(amt)} XRP`;
  const obj = amt as { value: string; currency?: string; mpt_issuance_id?: string };
  return `${obj.value} ${obj.currency ? decodeCurrency(obj.currency) : obj.mpt_issuance_id ? "MPT" : ""}`.trim();
}

const NFT_RELATED = new Set([
  "NFTokenMint",
  "NFTokenBurn",
  "NFTokenModify",
  "NFTokenCreateOffer",
  "NFTokenAcceptOffer",
  "NFTokenCancelOffer",
]);

/** A bulk NFTokenCancelOffer can touch dozens of tokens; link the first
 *  few and count the rest rather than resolving metadata for all. */
const MAX_NFT_LINKS = 10;

export type TypeField = { label: string; content: React.ReactNode };

/**
 * Extract type-specific fields for a transaction. Returned as data so
 * callers can `if (fields.length > 0)` before deciding whether to
 * render a card around them — used by the new layout that puts these
 * in their own "Type-specific Details" card (and skips the card
 * entirely when there's nothing to show).
 */
export function getTypeFields(tx: TxData): TypeField[] {
  const fields: TypeField[] = [];

  // The NFT is the subject of these types, so it always gets a row: the
  // resolved name when metadata loads, the truncated ID when it doesn't.
  if (NFT_RELATED.has(tx.TransactionType)) {
    const ids = findNftokenIds(tx);
    if (ids.length > 0) {
      const uri = typeof tx.URI === "string" ? tx.URI : undefined;
      fields.push({
        label: ids.length > 1 ? "NFTs" : "NFT",
        content: (
          <NftLinks ids={ids.slice(0, MAX_NFT_LINKS)} total={ids.length} uri={uri} />
        ),
      });
    }
  }

  if (tx.TransactionType === "Payment" && tx.SendMax) {
    fields.push({ label: "SendMax", content: formatXrpOrToken(tx.SendMax) });
  }

  if (tx.TransactionType === "OfferCreate") {
    if (tx.TakerPays) {
      fields.push({ label: "Taker Pays", content: formatXrpOrToken(tx.TakerPays) });
    }
    if (tx.TakerGets) {
      fields.push({ label: "Taker Gets", content: formatXrpOrToken(tx.TakerGets) });
    }
  }

  if (tx.TransactionType === "TrustSet" && tx.LimitAmount) {
    fields.push({
      label: "Limit Amount",
      content: (
        <>
          {(tx.LimitAmount as { value: string }).value}{" "}
          <span className="text-muted">{decodeCurrency((tx.LimitAmount as { currency: string }).currency)}</span>
        </>
      ),
    });
  }

  if (tx.TransactionType === "NFTokenMint" && tx.URI) {
    const decodedUri = hexToUtf8(tx.URI as string) || null;
    if (decodedUri) {
      fields.push({
        label: "URI",
        content: (
          <span className="break-all text-muted">
            {decodedUri}
          </span>
        ),
      });
    }
  }

  if (tx.TransactionType === "NFTokenAcceptOffer") {
    if (tx.NFTokenSellOffer) {
      fields.push({
        label: "Sell Offer",
        content: <span className="break-all text-muted">{tx.NFTokenSellOffer as string}</span>,
      });
    }
    if (tx.NFTokenBuyOffer) {
      fields.push({
        label: "Buy Offer",
        content: <span className="break-all text-muted">{tx.NFTokenBuyOffer as string}</span>,
      });
    }
  }

  if (tx.TransactionType === "EscrowCreate") {
    if (tx.FinishAfter) {
      fields.push({
        label: "Finish After",
        content: new Date(((tx.FinishAfter as number) + 946684800) * 1000).toUTCString(),
      });
    }
    if (tx.CancelAfter) {
      fields.push({
        label: "Cancel After",
        content: new Date(((tx.CancelAfter as number) + 946684800) * 1000).toUTCString(),
      });
    }
  }

  if (
    (tx.TransactionType === "EscrowFinish" || tx.TransactionType === "EscrowCancel") &&
    tx.Owner
  ) {
    fields.push({
      label: "Owner",
      content: <AddressLink address={tx.Owner as string} truncate={false} />,
    });
  }

  if (tx.Memos) {
    const memos = tx.Memos as Array<{ Memo: { MemoType?: string; MemoData?: string } }>;
    const decoded = memos.map((m, i) => {
      const data = m.Memo?.MemoData;
      if (!data) return null;
      return <span key={i}>{hexToUtf8(data)}</span>;
    });
    if (decoded.some(Boolean)) {
      fields.push({
        label: "Memos",
        content: <span className="break-all text-muted">{decoded}</span>,
      });
    }
  }

  return fields;
}
