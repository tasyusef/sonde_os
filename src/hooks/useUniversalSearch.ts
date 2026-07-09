"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { detectSearchType, parseAddressDT } from "@/lib/xrpl-helpers";
import type { SearchResult } from "@/types/search";

/**
 * Universal search hook used by SearchBar across the app.
 *
 * Tier 1 (client-side): Instantly routes unambiguous types.
 * Tier 2 (server-side): Calls /api/search for hex64, paystring, x-address.
 */
export function useUniversalSearch() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  // Abort in-flight request on unmount to prevent stale router.push
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const search = useCallback(
    async (input: string) => {
      const trimmed = input.trim();
      if (!trimmed) return;

      // Cancel any in-flight request
      abortRef.current?.abort();
      setError(null);

      const type = detectSearchType(trimmed);

      // Tier 1: instant client-side routing
      switch (type) {
        case "account":
          router.push(`/account/${trimmed}`);
          return;
        case "account-dt": {
          const parsed = parseAddressDT(trimmed);
          if (parsed) {
            router.push(`/account/${parsed.address}?dt=${parsed.dt}`);
          }
          return;
        }
        case "ledger":
          router.push(`/ledger/${trimmed}`);
          return;
        case "currency-hash":
        case "currency-code":
          router.push(`/markets?search=${encodeURIComponent(trimmed)}`);
          return;
      }

      // Tier 2: server-side resolution for ambiguous types
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);

      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );

        if (!res.ok) {
          setError("Search failed");
          return;
        }

        const data = (await res.json()) as SearchResult;

        if (data.redirect) {
          router.push(data.redirect);
        } else {
          setError(data.label ?? "No results found");
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setIsLoading(false);
          return;
        }
        setError("Search failed");
      } finally {
        setIsLoading(false);
      }
    },
    [router]
  );

  return { search, isLoading, error, clearError: () => setError(null) };
}
