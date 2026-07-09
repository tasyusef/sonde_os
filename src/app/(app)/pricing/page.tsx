import type { Metadata } from "next";
import PricingPage from "@/components/pricing/PricingPage";
import { PRICING } from "@/lib/pricing";
import { getSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  title: "Pricing — Sonde",
  description: "Intelligence for the XRP Ledger. Raw data is free. Synthesized intelligence is the product.",
  alternates: { canonical: "/pricing" },
};

/**
 * Schema.org Product + Offer JSON-LD for the Pro tier. Lets AI answer
 * engines (Perplexity, ChatGPT search, Gemini) cite specific pricing
 * rather than scraping prose, and lets Google show pricing in rich
 * SERP results.
 *
 * Lists the four price/cycle/method combos as separate Offers under
 * one Product so the schema reflects what's actually purchasable.
 */
function buildPricingJsonLd(siteUrl: string) {
  const offerBase = {
    "@type": "Offer" as const,
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    url: `${siteUrl}/pricing`,
    seller: { "@type": "Organization", name: "Sonde" },
  };

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Sonde Pro",
    description:
      "Pro subscription for Sonde — managed AI access for natural-language XRPL queries plus the full intelligence layer (account graphs, fund tracing, smart-money detail, whale activity, alerts).",
    brand: { "@type": "Brand", name: "Sonde" },
    url: `${siteUrl}/pricing`,
    offers: [
      {
        ...offerBase,
        name: "Pro — Monthly (crypto)",
        price: PRICING.pro.crypto.monthly.toString(),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: PRICING.pro.crypto.monthly,
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
      },
      {
        ...offerBase,
        name: "Pro — Annual (crypto)",
        price: PRICING.pro.crypto.annual.toString(),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: PRICING.pro.crypto.annual,
          priceCurrency: "USD",
          billingDuration: "P1Y",
        },
      },
      {
        ...offerBase,
        name: "Pro — Monthly (card)",
        price: PRICING.pro.fiat.monthly.toString(),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: PRICING.pro.fiat.monthly,
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
      },
      {
        ...offerBase,
        name: "Pro — Annual (card)",
        price: PRICING.pro.fiat.annual.toString(),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: PRICING.pro.fiat.annual,
          priceCurrency: "USD",
          billingDuration: "P1Y",
        },
      },
    ],
  };
}

export default function Pricing() {
  const jsonLd = buildPricingJsonLd(getSiteUrl());

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PricingPage />
    </>
  );
}
