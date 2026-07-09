import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTier } from "@/lib/subscription";
import AskChat from "./PageClient";
import UnauthHero from "./UnauthHero";
import FreeHero from "./FreeHero";

export const metadata: Metadata = {
  title: "Ask the Ledger",
  description:
    "Ask the XRP Ledger anything in plain English. Natural-language queries return charts, tables, and answers. Pro feature.",
  alternates: { canonical: "/asktheledger" },
};

// Tier-aware render — different UI per request, must not be statically prerendered.
export const dynamic = "force-dynamic";

export default async function AskTheLedgerPage() {
  const cookieStore = await cookies();
  const session = await getTier(cookieStore);

  if (session.tier === "pro") return <AskChat />;
  if (session.tier === "free") return <FreeHero />;
  return <UnauthHero />;
}
