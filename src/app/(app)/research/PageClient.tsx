"use client";

import { useState, useCallback, Suspense, lazy } from "react";
import { IntelligenceProvider, useIntelligence } from "@/components/intel/IntelligenceContext";
import PageHero from "@/components/shared/PageHero";
import Button from "@/components/shared/Button";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

// Lazy load to keep initial bundle small. Pre-2026-05-01 there was a
// second tab (Investigate / AI chat); cut alongside the Neo4j removal
// since investigate was tightly Cypher-coupled and not worth rebuilding
// against CH for a feature with negligible engagement.
const GraphTab = lazy(() => import("@/components/intel/IntelligenceDashboard/GraphTab"));

export default function IntelligencePage() {
  return (
    <IntelligenceProvider>
      <IntelligenceInner />
    </IntelligenceProvider>
  );
}

function IntelligenceInner() {
  const { activeAccount, setActiveAccount } = useIntelligence();
  const [accountInput, setAccountInput] = useState("");

  const handleAccountSearch = useCallback(() => {
    const trimmed = accountInput.trim();
    if (trimmed && XRPL_ADDRESS_RE.test(trimmed)) {
      setActiveAccount(trimmed);
    }
  }, [accountInput, setActiveAccount]);

  return (
    <main>
      <PageHero
        title="XRPL"
        accent="Research"
        subtitle="Trace funds and find shared counterparties between XRPL accounts."
        showDataWindow
      >
        {/* Account focus bar inside hero */}
        <div className="flex items-center gap-2 sm:max-w-lg">
          <input
            type="text"
            value={accountInput}
            onChange={(e) => setAccountInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAccountSearch()}
            placeholder="Focus on account..."
            className="flex-1 rounded-lg border border-elevated bg-elevated px-3 py-2 font-mono text-cell text-primary placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            aria-label="Set active account"
          />
          {activeAccount && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="rounded-lg bg-brand/10 px-2.5 py-1 font-mono text-cell text-brand">
                {activeAccount.slice(0, 8)}...{activeAccount.slice(-4)}
              </span>
              <Button
                onClick={() => setActiveAccount(null)}
                variant="secondary"
                size="sm"
                iconOnly
                aria-label="Clear active account"
                className="h-8 w-8 hover:bg-brand/10"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </Button>
            </div>
          )}
        </div>
      </PageHero>

      <div className="mx-auto max-w-container px-3 sm:px-6 py-6">
        <Suspense
          fallback={
            <div role="status" aria-label="Loading">
              <div className="h-64 animate-pulse motion-reduce:animate-none rounded-2xl bg-elevated" />
            </div>
          }
        >
          <GraphTab />
        </Suspense>
      </div>
    </main>
  );
}
