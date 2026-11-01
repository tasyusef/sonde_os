import CopyButton from "@/components/shared/CopyButton";
import Decode from "@/components/shared/Decode";

/**
 * The top of the token page's stage: its ticker, its name, its ID and,
 * when the issuer gave one, what it is. A ticker or a name is the
 * issuer's data, so it keeps its case and the data face.
 */
export default function TokenHero({
  kind,
  ticker,
  name,
  id,
  status,
  description,
}: {
  kind: "iou" | "mpt";
  ticker: string;
  name?: string;
  id: string;
  /** A state that stops the token moving: "Frozen", "Locked". */
  status?: string | null;
  description?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 font-display text-caps uppercase">
        <span className="text-muted">{kind === "mpt" ? "Multi-purpose token" : "Token"}</span>
        {status && <span className="text-error">{status}</span>}
      </div>

      <h1 className="mt-3 break-words font-mono text-value text-primary">
        <span className="sr-only">Token </span>
        {ticker}
      </h1>
      {name && <p className="mt-1 break-words font-mono text-body text-muted">{name}</p>}

      <div className="mt-2 flex items-start gap-2">
        <span className="sr-only">Token ID: </span>
        <span className="min-w-0 break-all font-mono text-cell text-primary">
          <Decode text={id} />
        </span>
        <CopyButton text={id} />
      </div>

      {description && (
        <p className="mt-4 break-words font-body text-ui leading-read-sm text-primary">{description}</p>
      )}
    </div>
  );
}
