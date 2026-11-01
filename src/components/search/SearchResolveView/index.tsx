import { useEffect } from "react";
import { useNavigate } from "react-router";
import TokenSearch from "@/components/search/TokenSearch";
import LoadingDots from "@/components/shared/LoadingDots";
import PageAlert, { UNREACHABLE_MESSAGE } from "@/components/shared/PageAlert";
import { useXrplQuery } from "@/hooks/useXrplQuery";
import { recentSearches } from "@/lib/recent-searches";
import { hitPath, looksLikeAddress, parseSearch, type SearchKind } from "@/lib/search";
import { resolveHexId } from "@/lib/search-resolve";

/**
 * `/search/<query>` body: opens the page a search names. An address, a
 * ledger number or a token ID goes straight there. A 64-hex ID is asked
 * of the ledger (`resolveHexId`) and opens as the transaction, ledger
 * or NFT it is, and joins the recent searches. Other text is looked up
 * in the token list (`TokenSearch`). The search page replaces itself,
 * so Back skips it.
 */
export default function SearchResolveView({ query }: { query: string }) {
  const navigate = useNavigate();
  const parsed = parseSearch(query);
  const hexId = parsed && !parsed.kind ? parsed.id : null;
  const { data, error, unreachable, retry } = useXrplQuery<SearchKind | null>(
    hexId ? ["resolve", hexId] : null,
    ({ send }) => resolveHexId(send, hexId!),
  );
  const kind = parsed?.kind ?? data;
  const id = parsed?.id;

  useEffect(() => {
    if (!kind || !id) return;
    const hit = { kind, id };
    recentSearches.add(hit);
    navigate(hitPath(hit), { replace: true });
  }, [kind, id, navigate]);

  if (!parsed) {
    if (looksLikeAddress(query.trim())) {
      return <PageAlert message="This address has a typo: its checksum doesn't match." detail={query} />;
    }
    return <TokenSearch query={query.trim()} />;
  }
  const detail = `ID: ${parsed.id}`;
  if (data === null) return <PageAlert message="No transaction, ledger or NFT has this ID" detail={detail} />;
  if (unreachable) return <PageAlert message={UNREACHABLE_MESSAGE} detail={detail} onRetry={retry} />;
  if (error) {
    return (
      <PageAlert
        message="Couldn't look this up. The XRPL nodes didn't answer."
        detail={detail}
        onRetry={retry}
      />
    );
  }
  return (
    <p role="status" className="flex items-center gap-3 font-mono text-cell text-muted">
      <LoadingDots className="shrink-0" />
      <span className="min-w-0 break-all">Looking up {parsed.id}</span>
    </p>
  );
}
