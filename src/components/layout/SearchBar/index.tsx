"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import { useUniversalSearch } from "@/hooks/useUniversalSearch";

interface SearchBarProps {
  variant?: "standalone" | "hero";
}

export default function SearchBar({ variant = "standalone" }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const { search, isLoading, error, clearError } = useUniversalSearch();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(query);
  };

  const form = (
    <form onSubmit={handleSubmit} className="relative w-full transition-transform duration-200 focus-within:scale-[1.005]">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          clearError();
        }}
        placeholder="Search address, tx hash, CTID, address:DT, NFT, token, ledger..."
        aria-label="Search accounts, transactions, CTIDs, destination tags, NFTs, tokens, or ledgers"
        aria-invalid={!!error}
        aria-describedby={error ? "searchbar-error" : undefined}
        disabled={isLoading}
        className={`w-full rounded-2xl border pl-4 pr-12 py-3 font-body text-ui text-primary placeholder:text-muted outline-none transition-all duration-200 bg-surface max-sm:text-[16px] ${
          error
            ? "border-error/50 ring-1 ring-error/20"
            : "border-border focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        } ${isLoading ? "opacity-60" : ""}`}
      />
      <Button
        type="submit"
        variant="ghost"
        iconOnly
        size="sm"
        loading={isLoading}
        disabled={!query.trim()}
        aria-label="Search"
        className="absolute top-1/2 right-3 h-8 w-8 -translate-y-1/2 hover:bg-brand hover:text-white"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </Button>
      {error && (
        <p id="searchbar-error" role="alert" className="mt-1.5 font-mono text-label text-error">
          {error}
        </p>
      )}
    </form>
  );

  if (variant === "hero") {
    return form;
  }

  return (
    <div className="border-b border-elevated">
      <div className="mx-auto max-w-container px-6 py-4">{form}</div>
    </div>
  );
}
