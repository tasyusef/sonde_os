import { type ReactNode, useId } from "react";
import Button from "@/components/shared/Button";
import LoadingDots from "@/components/shared/LoadingDots";

/**
 * A titled block on the flat page ground: a caps heading with its
 * count at the right edge, then the content. No box or rule around
 * it; space alone sets it apart from the next one.
 *
 * While the content loads, `status` takes the count's place, with
 * specific copy ("Loading 24 trust lines…", never "Loading…"). A
 * failed load puts `alert` there instead, with a retry.
 */
export default function Section({
  title,
  count,
  status,
  alert,
  note,
  children,
  className,
}: {
  title: string;
  count?: number;
  status?: string | null;
  alert?: { message: string; onRetry?: () => void } | null;
  /** A caveat under the content, e.g. "Some offers couldn't be loaded." */
  note?: string | null;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={className}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="font-display text-caps uppercase text-primary">
          {title}
        </h2>
        {status ? (
          <span role="status" className="flex items-center gap-1.5 font-mono text-tag text-muted">
            <LoadingDots className="text-brand" />
            {status}
          </span>
        ) : alert ? (
          <span role="alert" className="flex items-center gap-2 font-mono text-tag text-error">
            {alert.message}
            {alert.onRetry && (
              <Button variant="secondary" size="sm" onClick={alert.onRetry}>
                Try again
              </Button>
            )}
          </span>
        ) : (
          count != null &&
          count > 0 && (
            <span className="font-mono text-label tabular-nums text-muted">
              {count.toLocaleString()}
            </span>
          )
        )}
      </div>
      {children}
      {note && <p className="mt-2 font-mono text-tag text-muted">{note}</p>}
    </section>
  );
}

export { Section };
