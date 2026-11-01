import Button from "@/components/shared/Button";

/** Shown when no XRPL node has answered for a while (`unreachable`). */
export const UNREACHABLE_MESSAGE = "Can't reach the XRP Ledger right now.";

/**
 * Stands in for a page's subject when it can't be shown: not found,
 * invalid input, or the nodes didn't answer (`onRetry`). Sits on the
 * page ground like everything else.
 */
export default function PageAlert({
  message,
  detail,
  onRetry,
}: {
  message: string;
  /** Second line, e.g. the hash or address the visitor asked for. */
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert">
      <p className="font-mono text-body text-error">{message}</p>
      {detail && <p className="mt-2 break-all font-mono text-cell text-muted">{detail}</p>}
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="md" className="mt-4">
          Try again
        </Button>
      )}
    </div>
  );
}
