import Link from "next/link";
import type { NFTInfo } from "@/types/nft";
import CopyButton from "@/components/shared/CopyButton";
import { HeroBackground } from "@/components/shared/PageHero";

export default function NFTDetailHero({ nft }: { nft: NFTInfo }) {
  return (
    <section className="relative overflow-hidden md:-ml-18">
      <HeroBackground />

      <div className="relative mx-auto max-w-container px-6 pt-6 pb-8 sm:pt-8 sm:pb-10 md:pl-24">
        <Link
          href="/nft"
          className="mb-4 inline-flex items-center gap-1.5 font-display text-label uppercase tracking-header text-muted transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="size-3.5"
          >
            <path
              fillRule="evenodd"
              d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z"
              clipRule="evenodd"
            />
          </svg>
          NFTs
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="rounded-tag bg-tx-nft/10 px-2 py-0.5 font-mono text-tag font-medium text-tx-nft">
                NFT
              </span>
              {nft.is_burned ? (
                <span className="rounded-full bg-error/8 px-2 py-0.5 font-mono text-label font-semibold uppercase text-error">
                  Burned
                </span>
              ) : (
                <span className="rounded-full bg-success/8 px-2 py-0.5 font-mono text-label font-semibold uppercase text-success">
                  Active
                </span>
              )}
            </div>

            <h1 className="font-display text-heading font-bold tracking-[-0.5px] text-primary sm:text-title">
              NFT #{nft.nft_serial}
            </h1>

            <div className="flex items-center gap-2">
              <span className="sr-only">NFT Token ID: </span>
              <span className="font-mono text-cell text-brand break-all">
                {nft.nft_id}
              </span>
              <CopyButton text={nft.nft_id} />
            </div>
          </div>

          <a
            href={`https://xrp.cafe/nft/${nft.nft_id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg bg-elevated px-3 py-1.5 font-mono text-label font-medium text-secondary transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 sm:mt-1"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Trade on xrp.cafe
          </a>
        </div>
      </div>
    </section>
  );
}
