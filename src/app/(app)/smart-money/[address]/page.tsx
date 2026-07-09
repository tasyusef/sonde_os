import type { Metadata } from "next";
import WalletDetailPage from "@/components/smart-money/WalletDetailPage";
import { getSmartMoneyDetail } from "@/lib/smart-money-data";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  const short = `${address.slice(0, 8)}...${address.slice(-4)}`;
  return {
    title: `Smart Money — ${short}`,
    description: `Trading performance breakdown for XRPL wallet ${short}. Composite score, PnL, win rate, and factor analysis.`,
    alternates: { canonical: `/smart-money/${address}` },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;

  // Server-side pre-fetch: the score-detail row is shared with the
  // /api/smart-money/[address] route (same getSmartMoneyDetail helper),
  // so we can render the score gauge + factor breakdown at TTFB
  // instead of waiting for SWR's client-side fetch (~200-300 ms).
  // The component still wires SWR for revalidation; this just seeds
  // fallbackData. `null` means either the wallet isn't scored OR the
  // address is malformed — both cases hit the existing error UI in
  // WalletDetailPage so we don't change behavior.
  const initialDetail = XRPL_ADDRESS_RE.test(address)
    ? await getSmartMoneyDetail(address).catch(() => null)
    : null;

  return <WalletDetailPage address={address} initialDetail={initialDetail} />;
}
