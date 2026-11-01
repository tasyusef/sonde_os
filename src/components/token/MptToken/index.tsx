import PageAlert, { UNREACHABLE_MESSAGE } from "@/components/shared/PageAlert";
import PageTitle from "@/components/shared/PageTitle";
import StageRail from "@/components/shared/StageRail";
import TokenFigure from "@/components/token/TokenFigure";
import TokenHero from "@/components/token/TokenHero";
import { useMptIssuance } from "@/hooks/useToken";
import { formatScaled } from "@/lib/format";
import { getKnownName } from "@/lib/known-addresses";
import { MPT_LOCKED, parseMptMetadata } from "@/lib/token-info";
import type { Listing } from "@/lib/token-list";
import { truncate } from "@/lib/xrpl-helpers";
import MptFacts from "./MptFacts";

const amount = (raw: string | undefined, scale: number) => formatScaled(raw ? BigInt(raw) : 0n, scale);

/**
 * A multi-purpose token's page, from its issuance (`ledger_entry`): how
 * much is out on the stage, under what its metadata says it is; its
 * issuer, settings and links in the rail.
 */
export default function MptToken({ id, listed }: { id: string; listed: Listing | null }) {
  const { issuance, notFound, failed, unreachable, retry } = useMptIssuance(id);
  const meta = parseMptMetadata(issuance?.MPTokenMetadata);
  const ticker = meta?.ticker ?? listed?.ticker ?? "MPT";
  const issuer = issuance?.Issuer;
  const issuerName = listed?.issuerName ?? (issuer ? getKnownName(issuer) : null) ?? undefined;
  const scale = issuance?.AssetScale ?? 0;

  const detail = `MPT issuance ID: ${id}`;
  const alert = notFound ? (
    <PageAlert message="No MPT has this issuance ID" detail={detail} />
  ) : unreachable ? (
    <PageAlert message={UNREACHABLE_MESSAGE} detail={detail} onRetry={retry} />
  ) : failed ? (
    <PageAlert message="Couldn't load this token. The XRPL nodes didn't answer." detail={detail} onRetry={retry} />
  ) : null;

  return (
    <>
      {issuance && (
        <PageTitle>{`${ticker} by ${issuerName ?? truncate(issuance.Issuer)} — XRPL Token | Sonde`}</PageTitle>
      )}
      <StageRail
        stage={
          <>
            <TokenHero
              kind="mpt"
              ticker={ticker}
              name={meta?.name ?? listed?.name}
              id={id}
              status={issuance && issuance.Flags & MPT_LOCKED ? "Locked" : null}
              description={meta?.desc}
            />
            <div className="mt-10">
              {alert ?? (
                <TokenFigure
                  label="Supply"
                  value={issuance ? amount(issuance.OutstandingAmount, scale) : undefined}
                  unit={ticker}
                  note={issuance?.MaximumAmount && `of ${amount(issuance.MaximumAmount, scale)} at most`}
                />
              )}
            </div>
          </>
        }
        rail={alert ? null : <MptFacts issuance={issuance} meta={meta} issuerName={issuerName} listed={listed} />}
      />
    </>
  );
}
