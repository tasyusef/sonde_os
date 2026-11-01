import { describe, expect, it } from "vitest";
import { queryStatus } from "./query-status";

const base = { keyed: true, hasData: false, error: undefined, isValidating: false };
const abort = (() => {
  const ac = new AbortController();
  ac.abort();
  return ac.signal.reason;
})();

describe("queryStatus", () => {
  it("is loading until data or an error lands", () => {
    expect(queryStatus(base)).toEqual({ error: undefined, isLoading: true, unreachable: false });
    expect(queryStatus({ ...base, keyed: false })).toMatchObject({ error: undefined, isLoading: false });
  });

  it("shows an error only when there's no data", () => {
    const error = { error: "tooBusy" };
    expect(queryStatus({ ...base, error })).toMatchObject({ error, isLoading: false });
    expect(queryStatus({ ...base, hasData: true, error })).toMatchObject({
      error: undefined,
      isLoading: false,
    });
  });

  it("goes back to loading while an error is retried", () => {
    expect(queryStatus({ ...base, error: { error: "tooBusy" }, isValidating: true }).isLoading).toBe(
      true,
    );
  });

  it("never shows an abort", () => {
    expect(queryStatus({ ...base, error: abort })).toMatchObject({ error: undefined, isLoading: true });
  });

  it("reports unreachable only when there's nothing to show", () => {
    expect(queryStatus({ ...base, unreachable: true }).unreachable).toBe(true);
    expect(queryStatus({ ...base, hasData: true, unreachable: true }).unreachable).toBe(false);
    expect(queryStatus({ ...base, keyed: false, unreachable: true }).unreachable).toBe(false);
  });
});
