import AddressLink from "@/components/shared/AddressLink";
import Facts, { Fact } from "@/components/shared/Facts";
import Section from "@/components/shared/Section";
import IssuerLink from "@/components/token/IssuerLink";
import { hexToUtf8 } from "@/lib/hex";
import { formatPercent, formatTokenAmount, issuerFlags, poolPrice, transferRatePercent, webUrl } from "@/lib/token-info";
import { formatListDate, type Listing } from "@/lib/token-list";
import type { AccountInfoResponse } from "@/types/xrpl-responses";
import type { AMMInfoResult } from "@/types/amm";

const none = <span className="text-muted">None</span>;

/** The IOU page's rail: the issuer and the settings on its account that
 *  govern the token, then its XRP pool when it has one. */
export default function IouFacts({
  issuer,
  issuerName,
  ticker,
  account,
  pool,
  listed,
}: {
  issuer: string;
  issuerName?: string;
  ticker: string;
  account: AccountInfoResponse["account_data"] | undefined;
  pool: AMMInfoResult["amm"] | null | undefined;
  listed: Listing | null;
}) {
  const domain = account?.Domain ? hexToUtf8(account.Domain) : undefined;
  const domainUrl = domain ? webUrl(domain) : null;
  const flags = account ? issuerFlags(account.Flags) : [];
  const price = pool ? poolPrice(pool) : null;

  return (
    <>
      <Section
        title="Details"
        status={account ? null : "Loading the issuer's settings…"}
        note={listed ? `Holders per XRPL Meta, ${formatListDate(listed.made)}.` : null}
      >
        <Facts>
          <Fact label="Issuer">
            <IssuerLink address={issuer} name={issuerName} />
          </Fact>
          {domain && (
            <Fact label="Domain">
              {domainUrl ? (
                <a href={domainUrl} target="_blank" rel="noopener noreferrer" className="link">
                  {domain}
                </a>
              ) : (
                domain
              )}
            </Fact>
          )}
          {listed && (
            <Fact label="Holders">
              <span className="tabular-nums">{listed.holders.toLocaleString()}</span>
            </Fact>
          )}
          {account && (
            <>
              <Fact label="Transfer Fee">
                <span className="tabular-nums">{formatPercent(transferRatePercent(account.TransferRate))}</span>
              </Fact>
              <Fact label="Flags">{flags.length > 0 ? flags.join(" · ") : none}</Fact>
            </>
          )}
        </Facts>
      </Section>

      {pool && (
        <Section title="XRP Pool">
          <Facts>
            {price && (
              <>
                <Fact label="XRP">
                  <span className="tabular-nums">{formatTokenAmount(price.xrp)}</span>
                </Fact>
                <Fact label={ticker} dataLabel>
                  <span className="tabular-nums">{formatTokenAmount(price.tokens)}</span>
                </Fact>
              </>
            )}
            <Fact label="Trading Fee">
              <span className="tabular-nums">{formatPercent(pool.trading_fee / 1000)}</span>
            </Fact>
            <Fact label="Pool Account">
              <AddressLink address={pool.account} />
            </Fact>
          </Facts>
        </Section>
      )}
    </>
  );
}
