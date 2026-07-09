import Link from "next/link";
import { dropsToXrp, truncateHash } from "@/lib/xrpl-helpers";
import { getNFTMetadataBatch } from "@/lib/nft-metadata-resolver";
import { extractCollectionName } from "@/lib/nft-metadata-fetcher";

interface TxData {
  [key: string]: unknown;
  TransactionType: string;
}

function formatXrpOrToken(amt: unknown): string {
  if (typeof amt === "string") return `${dropsToXrp(amt)} XRP`;
  const obj = amt as { value: string; currency: string };
  return `${obj.value} ${obj.currency}`;
}

function TableRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-elevated last:border-b-0">
      <td className="w-[180px] px-4 py-row font-display text-label font-medium uppercase tracking-header text-muted align-top">
        {label}
      </td>
      <td className="px-4 py-row">
        <span className="font-mono text-cell text-primary">{children}</span>
      </td>
    </tr>
  );
}

/** Pull a candidate NFTokenID from an NFT-related tx, checking the tx body
 *  first (direct on NFTokenCreateOffer / NFTokenBurn) then `meta.nftoken_id`. */
function findNftokenId(tx: TxData): string | null {
  const direct = tx.NFTokenID;
  if (typeof direct === "string" && /^[A-Fa-f0-9]{64}$/.test(direct)) {
    return direct;
  }
  const meta = (tx.meta ?? tx.metaData) as
    | { nftoken_id?: string }
    | undefined;
  if (meta?.nftoken_id && /^[A-Fa-f0-9]{64}$/.test(meta.nftoken_id)) {
    return meta.nftoken_id;
  }
  return null;
}

export type TypeField = { label: string; content: React.ReactNode };

/**
 * Extract type-specific fields for a transaction. Returned as data so
 * callers can `if (fields.length > 0)` before deciding whether to
 * render a card around them — used by the new layout that puts these
 * in their own "Type-specific Details" card (and skips the card
 * entirely when there's nothing to show).
 */
export async function getTypeFields(tx: TxData): Promise<TypeField[]> {
  const fields: TypeField[] = [];

  // Resolve NFT + collection names for NFT-related tx types.
  const nftRelated = new Set([
    "NFTokenMint",
    "NFTokenBurn",
    "NFTokenCreateOffer",
    "NFTokenAcceptOffer",
    "NFTokenCancelOffer",
  ]);
  if (nftRelated.has(tx.TransactionType)) {
    const nftokenId = findNftokenId(tx);
    if (nftokenId) {
      const uri = typeof tx.URI === "string" ? tx.URI : undefined;
      const resolved = await getNFTMetadataBatch([{ nftokenId, uri }]).catch(
        () => new Map(),
      );
      const meta = resolved.get(nftokenId);
      if (meta) {
        const displayName = meta.name ?? truncateHash(nftokenId, 8);
        const collection = meta.name
          ? extractCollectionName(meta.name)
          : null;
        fields.push({
          label: "NFT",
          content: (
            <Link
              href={`/nft/${nftokenId}`}
              className="inline-flex items-baseline gap-2 text-brand hover:text-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              <span>{displayName}</span>
              {collection && collection !== displayName ? (
                <span className="font-mono text-tag text-muted">
                  · {collection}
                </span>
              ) : null}
            </Link>
          ),
        });
      }
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
          <span className="text-muted">{(tx.LimitAmount as { currency: string }).currency}</span>
        </>
      ),
    });
  }

  if (tx.TransactionType === "NFTokenMint" && tx.URI) {
    let decodedUri: string | null = null;
    try {
      decodedUri = Buffer.from(tx.URI as string, "hex").toString("utf-8") || null;
    } catch { /* non-hex URI */ }
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
      content: <span className="text-brand">{tx.Owner as string}</span>,
    });
  }

  if (tx.Memos) {
    const memos = tx.Memos as Array<{ Memo: { MemoType?: string; MemoData?: string } }>;
    const decoded = memos.map((m, i) => {
      const data = m.Memo?.MemoData;
      if (!data) return null;
      try {
        return <span key={i}>{Buffer.from(data, "hex").toString("utf-8")}</span>;
      } catch {
        return <span key={i}>{data}</span>;
      }
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

/**
 * Existing TypeFields export — kept as a thin wrapper around
 * getTypeFields so any call site that still uses the renderRow
 * callback pattern keeps working. New call sites should prefer
 * getTypeFields + their own renderer.
 */
export async function TypeFields({
  tx,
  renderRow,
}: {
  tx: TxData;
  renderRow?: (label: string, children: React.ReactNode) => React.ReactNode;
}) {
  const fields = await getTypeFields(tx);
  if (fields.length === 0) return null;

  return (
    <>
      {fields.map((field) =>
        renderRow ? (
          <span key={field.label}>{renderRow(field.label, field.content)}</span>
        ) : (
          <TableRow key={field.label} label={field.label}>
            {field.content}
          </TableRow>
        ),
      )}
    </>
  );
}
