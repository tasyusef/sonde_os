import { useMemo } from "react";
import AccountBalance from "@/components/account/AccountBalance";
import AccountDetails from "@/components/account/AccountDetails";
import AccountHero from "@/components/account/AccountHero";
import { BalanceSkeleton, DetailsSkeleton, TabsSkeleton } from "@/components/account/AccountSkeleton";
import AccountTabs from "@/components/account/AccountTabs";
import PageAlert, { UNREACHABLE_MESSAGE } from "@/components/shared/PageAlert";
import PageTitle from "@/components/shared/PageTitle";
import StageRail from "@/components/shared/StageRail";
import { useAccountInfo } from "@/hooks/useAccountInfo";
import { useXrpPrice } from "@/hooks/useXrpPrice";
import { getAccountType, getKnownName } from "@/lib/known-addresses";

/**
 * Account page body, laid out like the NFT page: the account and its
 * balance on the stage, its details in the rail, the tabs across the
 * full width below. The hero renders straight from the URL; the rest
 * waits for `account_info` over the browser socket.
 */
export default function AccountView({
  address,
  destinationTag,
}: {
  address: string;
  destinationTag: number | null;
}) {
  const { info, valid, notFound, failed, unreachable, retry } = useAccountInfo(address);
  const xrpPrice = useXrpPrice()?.price ?? 0;
  const knownName = getKnownName(address);
  const data = info?.account_data;

  const accountType = useMemo(
    () =>
      data
        ? getAccountType(data.Flags, {
            regularKey: data.RegularKey,
            transferRate: data.TransferRate,
            domain: data.Domain,
            nfTokenMinter: data.NFTokenMinter,
          })
        : null,
    [data],
  );

  const detail = `Address: ${address}`;
  const alert = !valid ? (
    <PageAlert message="Invalid XRPL address format" detail={detail} />
  ) : notFound ? (
    <PageAlert message="Account not found or not activated" detail={detail} />
  ) : unreachable ? (
    <PageAlert message={UNREACHABLE_MESSAGE} detail={detail} onRetry={retry} />
  ) : failed ? (
    <PageAlert message="Couldn't load this account. The XRPL nodes didn't answer." detail={detail} onRetry={retry} />
  ) : null;

  return (
    <div className="min-h-screen">
      {data && <PageTitle>{`${knownName ?? `${address.slice(0, 8)}...${address.slice(-6)}`} — XRPL Account | Sonde`}</PageTitle>}
      <main id="main-content" className="mx-auto max-w-container px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        <StageRail
          stage={
            <>
              <AccountHero
                address={address}
                knownName={knownName}
                destinationTag={destinationTag}
                accountType={accountType}
                watchable={valid}
              />
              <div className="mt-10">
                {alert ?? (data ? <AccountBalance drops={data.Balance} xrpPrice={xrpPrice} /> : <BalanceSkeleton />)}
              </div>
            </>
          }
          rail={
            alert ? null : data ? (
              <AccountDetails address={address} drops={data.Balance} ownerCount={data.OwnerCount} xrpPrice={xrpPrice} />
            ) : (
              <DetailsSkeleton />
            )
          }
        />
        {data ? (
          <AccountTabs
            className="mt-16"
            address={address}
            xrpBalance={data.Balance}
            xrpPrice={xrpPrice}
            filterDestinationTag={destinationTag}
            accountSettings={{
              flags: data.Flags,
              domain: data.Domain,
              regularKey: data.RegularKey,
              transferRate: data.TransferRate,
              tickSize: data.TickSize,
              nfTokenMinter: data.NFTokenMinter,
              mintedNFTokens: data.MintedNFTokens,
              burnedNFTokens: data.BurnedNFTokens,
            }}
          />
        ) : (
          !alert && <TabsSkeleton className="mt-16" />
        )}
      </main>
    </div>
  );
}
