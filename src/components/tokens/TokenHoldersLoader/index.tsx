import { getHolderData } from "@/lib/holder-queries";
import TokenHolders from "@/components/tokens/TokenHolders";

export default async function TokenHoldersLoader({
  currency,
  issuer,
  currencyDisplay,
}: {
  currency: string;
  issuer: string;
  currencyDisplay: string;
}) {
  let data;
  try {
    data = await getHolderData(currency, issuer, "30d");
  } catch {
    // Table may not exist yet (migration not applied), or XRPL fetch failed
    return null;
  }

  if (!data.current || data.current.holders.length === 0) {
    return null;
  }

  return (
    <TokenHolders
      data={data}
      currency={currency}
      issuer={issuer}
      currencyDisplay={currencyDisplay}
    />
  );
}

export { TokenHoldersLoader };
