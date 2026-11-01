import { type ReactNode, useState } from "react";
import Facts, { Fact } from "@/components/shared/Facts";
import LoadingDots from "@/components/shared/LoadingDots";
import Section from "@/components/shared/Section";
import { useAccountAncestry } from "@/hooks/useAccountAncestry";
import { useAccountTotalValue } from "@/hooks/useAccountTotalValue";
import { useReserves } from "@/hooks/useReserves";
import { accountAge, formatVolume } from "@/lib/format";
import { dropsToXrp, formatDate } from "@/lib/xrpl-helpers";

const xrp = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} XRP`;

/** Dots while a value is on its way, a dash if it never comes. */
function pending(loading: boolean, value: ReactNode) {
  if (loading) return <LoadingDots className="text-muted" />;
  return value || <span className="text-muted">—</span>;
}

/**
 * The account page's rail: what its holdings are worth, what the
 * reserve holds back, and when it was activated. The total fills in
 * once every tab's data has landed; the dates once ancestry has.
 */
export default function AccountDetails({
  address,
  drops,
  ownerCount,
  xrpPrice,
}: {
  address: string;
  drops: string;
  ownerCount: number;
  xrpPrice: number;
}) {
  const reserves = useReserves();
  const balance = parseFloat(dropsToXrp(drops));
  const reserve = reserves.base + ownerCount * reserves.owner;
  const totals = useAccountTotalValue(address, balance * xrpPrice, xrpPrice);
  const ancestry = useAccountAncestry(address);
  const activated = ancestry.ancestry.activationDate ?? null;
  const [now] = useState(() => Date.now());

  return (
    <Section title="Details">
      <Facts>
        <Fact label="Total value">
          {pending(
            !totals,
            totals && xrpPrice > 0 && (
              <>
                {formatVolume(totals.valueUsd)}
                {totals.note && <span className="block text-tag text-muted">{totals.note}</span>}
              </>
            ),
          )}
        </Fact>
        <Fact label="Reserve">{xrp(reserve)}</Fact>
        <Fact label="Available">{xrp(Math.max(0, balance - reserve))}</Fact>
        <Fact label="Activated">
          {pending(ancestry.isLoading, activated != null && formatDate(activated))}
        </Fact>
        <Fact label="Age">{pending(ancestry.isLoading, activated != null && accountAge(activated, now))}</Fact>
      </Facts>
    </Section>
  );
}

export { AccountDetails };
