import type { RefObject } from "react";
import Button from "@/components/shared/Button";
import { cn } from "@/lib/utils";

interface LoadFromHostProps {
  host: string;
  /** What the click loads, for the accessible name. */
  what: "image" | "metadata";
  onLoad: () => void;
  /** Takes focus on click. The button unmounts once the host is
   *  allowed, so this must be an element that stays (focusable, e.g.
   *  `tabIndex={-1}`), or keyboard users land back at the page top. */
  focusTarget: RefObject<HTMLElement | null>;
  /** Add the line saying why it asks. */
  explain?: boolean;
  className?: string;
}

/**
 * Click-to-load for NFT media on a host outside our gateways and
 * trusted list (`isAutoLoadHost`). The browser fetches it directly, so
 * loading shows that host the visitor's IP address.
 */
export default function LoadFromHost({
  host,
  what,
  onLoad,
  focusTarget,
  explain,
  className,
}: LoadFromHostProps) {
  const button = (
    <Button
      // An elevated fill: place it on a surface, not an elevated slot.
      variant="secondary"
      size="sm"
      onClick={() => {
        focusTarget.current?.focus({ preventScroll: true });
        onLoad();
      }}
      aria-label={`Load ${what} from ${host}`}
      className={cn("max-w-full", !explain && className)}
    >
      <span className="min-w-0 truncate">Load from {host}</span>
    </Button>
  );
  if (!explain) return button;
  return (
    <div className={cn("flex min-w-0 flex-col items-center gap-2 text-center", className)}>
      {button}
      <p className="font-mono text-label text-muted">Loading shares your IP address with this site.</p>
    </div>
  );
}
