import type { MPTokenIssuance } from "@/components/account/MPTokenList";
import Facts, { Fact } from "@/components/shared/Facts";
import Section from "@/components/shared/Section";
import IssuerLink from "@/components/token/IssuerLink";
import { formatPercent, type MptMetadata, mptFeePercent, mptFlags, webUrl } from "@/lib/token-info";
import { formatListDate, type Listing } from "@/lib/token-list";

const none = <span className="text-muted">None</span>;

/** The MPT page's rail: its issuer and settings, then the links its
 *  metadata gives. */
export default function MptFacts({
  issuance,
  meta,
  issuerName,
  listed,
}: {
  issuance: MPTokenIssuance | null;
  meta: MptMetadata | null;
  issuerName?: string;
  listed: Listing | null;
}) {
  const flags = issuance ? mptFlags(issuance.Flags) : [];
  const assetClass = [meta?.assetClass, meta?.assetSubclass].filter(Boolean).join(" · ");

  return (
    <>
      <Section
        title="Details"
        status={issuance ? null : "Loading the issuance…"}
        note={listed ? `Holders per XRPL Meta, ${formatListDate(listed.made)}.` : null}
      >
        {issuance && (
          <Facts>
            <Fact label="Issuer">
              <IssuerLink address={issuance.Issuer} name={issuerName} />
            </Fact>
            {/* The issuer's own word for itself, when the list doesn't already say it. */}
            {meta?.issuerName && meta.issuerName.toLowerCase() !== issuerName?.toLowerCase() && (
              <Fact label="Issuer Name">{meta.issuerName}</Fact>
            )}
            {listed && (
              <Fact label="Holders">
                <span className="tabular-nums">{listed.holders.toLocaleString()}</span>
              </Fact>
            )}
            {assetClass && <Fact label="Asset Class">{assetClass}</Fact>}
            <Fact label="Decimals">
              <span className="tabular-nums">{issuance.AssetScale ?? 0}</span>
            </Fact>
            <Fact label="Transfer Fee">
              <span className="tabular-nums">{formatPercent(mptFeePercent(issuance.TransferFee))}</span>
            </Fact>
            <Fact label="Flags">{flags.length > 0 ? flags.join(" · ") : none}</Fact>
          </Facts>
        )}
      </Section>

      {meta && meta.links.length > 0 && (
        <Section title="Links" count={meta.links.length}>
          <Facts>
            {meta.links.map((link, i) => {
              const url = webUrl(link.uri);
              return (
                <Fact key={`${link.uri}-${i}`} label={link.title ?? link.category ?? "Link"} dataLabel>
                  {url ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="link">
                      {new URL(url).host}
                    </a>
                  ) : (
                    link.uri
                  )}
                </Fact>
              );
            })}
          </Facts>
        </Section>
      )}
    </>
  );
}
