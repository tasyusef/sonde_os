import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import TokenResults from "@/components/search/TokenResults";
import LoadingDots from "@/components/shared/LoadingDots";
import PageAlert from "@/components/shared/PageAlert";
import PageTitle from "@/components/shared/PageTitle";
import { recentSearches } from "@/lib/recent-searches";
import { hitPath } from "@/lib/search";
import { tokenId } from "@/lib/token-id";
import { matchTokens, onlyMatch, useTokenList } from "@/lib/token-list";

/**
 * `/search/<text>`: a ticker or a name, looked up in the token list.
 * The one token it names opens in its place (and joins the recent
 * searches); several are listed; none says what search takes.
 */
export default function TokenSearch({ query }: { query: string }) {
  const navigate = useNavigate();
  const { list, failed, retry } = useTokenList();
  const matches = useMemo(() => (list ? matchTokens(list.tokens, query) : []), [list, query]);
  const only = list ? onlyMatch(list.tokens, query) : null;
  const onlyId = only && tokenId(only.ref);

  useEffect(() => {
    if (!onlyId) return;
    const hit = { kind: "token" as const, id: onlyId };
    recentSearches.add(hit);
    navigate(hitPath(hit), { replace: true });
  }, [onlyId, navigate]);

  const detail = `Search: ${query}`;
  if (failed) return <PageAlert message="Couldn't load the token list." detail={detail} onRetry={retry} />;
  if (!list || onlyId) {
    return (
      <p role="status" className="flex items-center gap-3 font-mono text-cell text-muted">
        <LoadingDots className="shrink-0" />
        <span className="min-w-0 break-all">Looking up {query}</span>
      </p>
    );
  }
  if (matches.length === 0) {
    return <PageAlert message="No match. Search takes an address, hash, ledger number, NFT ID or token." detail={detail} />;
  }
  return (
    <>
      <PageTitle>{`Tokens matching ${query} | Sonde`}</PageTitle>
      <TokenResults tokens={matches} query={query} made={list.made} />
    </>
  );
}
