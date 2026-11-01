import { useId, useSyncExternalStore } from "react";
import { Link } from "react-router";
import Button from "@/components/shared/Button";
import { formatInteger } from "@/lib/format";
import { getKnownName } from "@/lib/known-addresses";
import { recentSearches } from "@/lib/recent-searches";
import { hitPath, type SearchHit, type SearchKind } from "@/lib/search";
import { parseTokenId } from "@/lib/token-id";
import { cn } from "@/lib/utils";
import { decodeCurrency, truncate } from "@/lib/xrpl-helpers";
import { navRowClass } from "./NavLink";

const KIND_LABEL: Record<SearchKind, string> = {
  account: "Account",
  transaction: "Tx",
  ledger: "Ledger",
  nft: "NFT",
  token: "Token",
};

/** A known account by name, a ledger by its number, an issued token by
 *  its ticker, anything else shortened. */
function hitLabel({ kind, id }: SearchHit) {
  if (kind === "ledger") return formatInteger(id);
  if (kind === "account") return getKnownName(id) ?? truncate(id);
  const ref = kind === "token" ? parseTokenId(id) : null;
  if (ref?.kind === "iou") return decodeCurrency(ref.currency);
  return truncate(id);
}

/**
 * The last few searches (`lib/recent-searches`) under Watchlist, so a
 * search stays one click away after you've moved on. Nothing until
 * there's one. The collapsed rail drops it: with no labels, its rows
 * would all look the same.
 */
export function RecentSearches({ pathname }: { pathname: string }) {
  const hits = useSyncExternalStore(
    recentSearches.subscribe,
    recentSearches.getSnapshot,
    recentSearches.getServerSnapshot,
  );
  const headingId = useId();
  if (hits.length === 0) return null;

  return (
    <nav aria-labelledby={headingId} className="flex flex-col md:rail:hidden">
      <div className="flex h-9 items-center justify-between pl-2">
        <span id={headingId} className="font-display text-caps uppercase text-muted">
          Recent<span className="sr-only"> searches</span>
        </span>
        <Button variant="ghost" size="sm" onClick={recentSearches.clear}>
          Clear<span className="sr-only"> recent searches</span>
        </Button>
      </div>
      <ul className="flex flex-col">
        {hits.map((hit) => {
          const path = hitPath(hit);
          const active = pathname === path;
          return (
            <li key={path}>
              <Link
                to={path}
                title={hit.id}
                aria-current={active ? "page" : undefined}
                className={cn("group flex h-9 items-center gap-2 pr-3 pl-2", navRowClass(active))}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-ui">{hitLabel(hit)}</span>
                <span
                  className={cn(
                    "shrink-0 font-display text-caps uppercase",
                    !active && "text-muted group-hover:text-black",
                  )}
                >
                  {KIND_LABEL[hit.kind]}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
