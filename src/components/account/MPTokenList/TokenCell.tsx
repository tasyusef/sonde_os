import { Link } from "react-router";
import CopyButton from "@/components/shared/CopyButton";
import { tokenPath } from "@/lib/token-id";

/** An issuance ID's sequence (its first 8 hex) and the end of its
 *  issuer, so one issuer's tokens don't all read the same. */
function truncateId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;
}

/**
 * An MPT: the ticker its metadata gives, over its issuance ID, or the
 * ID alone. Either opens its token page.
 */
export default function TokenCell({ id, ticker }: { id: string; ticker?: string }) {
  const to = tokenPath({ kind: "mpt", id });
  return (
    <>
      {ticker && (
        <Link to={to} className="link break-words font-mono text-cell font-medium text-primary">
          {ticker}
        </Link>
      )}
      <span className="flex items-center gap-1.5">
        {ticker ? (
          <span className="font-mono text-tag text-muted">{truncateId(id)}</span>
        ) : (
          <Link to={to} title={id} className="link font-mono text-cell text-primary">
            {truncateId(id)}
          </Link>
        )}
        <CopyButton text={id} />
      </span>
    </>
  );
}
