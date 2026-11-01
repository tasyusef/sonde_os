import PageAlert, { UNREACHABLE_MESSAGE } from "@/components/shared/PageAlert";
import PageTitle from "@/components/shared/PageTitle";
import StageRail from "@/components/shared/StageRail";
import TokenFigure from "@/components/token/TokenFigure";
import TokenHero from "@/components/token/TokenHero";
import { useAccountInfo } from "@/hooks/useAccountInfo";
import { useIssuedTokens } from "@/hooks/useIssuedTokens";
import { useXrpPool } from "@/hooks/useToken";
import { useXrpPrice } from "@/hooks/useXrpPrice";
import { getKnownName } from "@/lib/known-addresses";
import { formatTokenAmount, GLOBAL_FREEZE, poolPrice } from "@/lib/token-info";
import type { Listing } from "@/lib/token-list";
import { decodeCurrency, truncate } from "@/lib/xrpl-helpers";
import IouFacts from "./IouFacts";

/**
 * An issued currency's page: what one costs in its XRP pool and how much
 * is out, on the stage; its issuer's settings and the pool in the rail.
 * Read live: the issuer's `account_info`, `gateway_balances` for the
 * supply, `amm_info` for the pool.
 */
export default function IouToken({
  currency,
  issuer,
  id,
  listed,
}: {
  currency: string;
  issuer: string;
  id: string;
  listed: Listing | null;
}) {
  const { info, notFound, failed, unreachable, retry } = useAccountInfo(issuer);
  const { issuedTokens, isLoading, error } = useIssuedTokens(issuer);
  const { pool } = useXrpPool(currency, issuer);
  const xrpUsd = useXrpPrice()?.price ?? 0;
  const ticker = decodeCurrency(currency);
  const issuerName = listed?.issuerName ?? getKnownName(issuer) ?? undefined;
  const account = info?.account_data;
  const price = pool ? poolPrice(pool) : null;
  const supply = isLoading ? undefined : error ? "—" : formatTokenAmount(issuedTokens[currency] ?? 0);

  const detail = `Issuer: ${issuer}`;
  const alert = notFound ? (
    <PageAlert message="This token's issuer isn't on the ledger" detail={detail} />
  ) : unreachable ? (
    <PageAlert message={UNREACHABLE_MESSAGE} detail={detail} onRetry={retry} />
  ) : failed ? (
    <PageAlert message="Couldn't load this token. The XRPL nodes didn't answer." detail={detail} onRetry={retry} />
  ) : null;

  return (
    <>
      <PageTitle>{`${ticker} by ${issuerName ?? truncate(issuer)} — XRPL Token | Sonde`}</PageTitle>
      <StageRail
        stage={
          <>
            <TokenHero
              kind="iou"
              ticker={ticker}
              name={listed?.name}
              id={id}
              status={account && account.Flags & GLOBAL_FREEZE ? "Frozen" : null}
            />
            <div className="mt-10">
              {alert ?? (
                <div className="flex flex-wrap gap-x-16 gap-y-8">
                  <TokenFigure
                    label="Price"
                    value={pool === undefined ? undefined : price ? formatTokenAmount(price.price) : "—"}
                    unit={price ? "XRP" : undefined}
                    note={
                      price
                        ? `${xrpUsd > 0 ? `≈ $${formatTokenAmount(price.price * xrpUsd)}, ` : ""}from its XRP pool`
                        : pool === null && "No XRP pool"
                    }
                  />
                  <TokenFigure label="Supply" value={supply} unit={ticker} />
                </div>
              )}
            </div>
          </>
        }
        rail={
          alert ? null : (
            <IouFacts issuer={issuer} issuerName={issuerName} ticker={ticker} account={account} pool={pool} listed={listed} />
          )
        }
      />
    </>
  );
}
