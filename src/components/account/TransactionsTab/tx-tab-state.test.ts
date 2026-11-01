import { describe, expect, it } from "vitest";
import { FILTER_PASS_PAGES, txListView, txLoadDecision, txStatusCopy } from "./tx-tab-state";

describe("txListView", () => {
  const base = { loading: false, failed: false, itemCount: 0 };

  it("is loading until the first page lands or fails", () => {
    expect(txListView({ ...base, loading: true })).toBe("loading");
  });

  it("shows the error, never the empty state, after a failed request", () => {
    expect(txListView({ ...base, failed: true })).toBe("error");
  });

  it("is empty only after a successful request with zero items", () => {
    expect(txListView(base)).toBe("empty");
    expect(txListView({ ...base, itemCount: 3 })).toBe("list");
  });
});

describe("txStatusCopy", () => {
  const base = { visibleCount: 0, isFetching: false, failed: false };

  it("stays silent after a failed initial request", () => {
    expect(txStatusCopy({ ...base, failed: true, visibleCount: 20 })).toBeNull();
  });

  it("narrates a retry after a failure", () => {
    expect(txStatusCopy({ ...base, failed: true, isFetching: true })).toBe(
      "Loading transactions",
    );
  });

  it("reports loading and showing counts", () => {
    expect(txStatusCopy({ ...base, isFetching: true })).toBe("Loading transactions");
    expect(txStatusCopy({ ...base, isFetching: true, visibleCount: 1234 })).toBe(
      "Loading 1,234 transactions",
    );
    expect(txStatusCopy({ ...base, visibleCount: 7 })).toBe("Showing 7 transactions");
  });

  it("counts what a tag search has covered", () => {
    expect(txStatusCopy({ ...base, filtering: true, visibleCount: 500 })).toBe(
      "Searched 500 transactions",
    );
    expect(txStatusCopy({ ...base, filtering: true, isFetching: true, visibleCount: 50 })).toBe(
      "Searching 50 transactions",
    );
  });
});

describe("txLoadDecision", () => {
  const base = { needsMore: true, hasMore: true, loadingMore: false, filtering: false, pagesThisPass: 0 };

  it("loads when the visitor pages past what's loaded", () => {
    expect(txLoadDecision(base)).toEqual({ autoLoad: true, paused: false });
    expect(txLoadDecision({ ...base, needsMore: false }).autoLoad).toBe(false);
    expect(txLoadDecision({ ...base, hasMore: false }).autoLoad).toBe(false);
    expect(txLoadDecision({ ...base, loadingMore: true }).autoLoad).toBe(false);
  });

  it("never pauses an unfiltered list", () => {
    expect(txLoadDecision({ ...base, pagesThisPass: 1_000 })).toEqual({ autoLoad: true, paused: false });
  });

  it("caps a tag search at FILTER_PASS_PAGES pages per pass", () => {
    const filtered = { ...base, filtering: true };
    expect(txLoadDecision({ ...filtered, pagesThisPass: FILTER_PASS_PAGES - 1 }).autoLoad).toBe(true);
    expect(txLoadDecision({ ...filtered, pagesThisPass: FILTER_PASS_PAGES })).toEqual({
      autoLoad: false,
      paused: true,
    });
  });

  it("walks at most FILTER_PASS_PAGES pages for a tag nothing carries", () => {
    // Simulate the list's effect loop: every page adds zero matches.
    let pages = 0;
    for (let i = 0; i < 1_000; i++) {
      const d = txLoadDecision({ ...base, filtering: true, pagesThisPass: pages });
      if (!d.autoLoad) break;
      pages++;
    }
    expect(pages).toBe(FILTER_PASS_PAGES);
  });

  it("doesn't show the pause at the end of history", () => {
    expect(
      txLoadDecision({ ...base, filtering: true, hasMore: false, pagesThisPass: FILTER_PASS_PAGES }).paused,
    ).toBe(false);
  });
});
