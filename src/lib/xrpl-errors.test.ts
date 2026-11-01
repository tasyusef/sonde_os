import { describe, expect, it, vi } from "vitest";
import {
  isAbortError,
  isNotFoundError,
  sendConfirmingNotFound,
  xrplErrorCode,
} from "./xrpl-errors";
import type { SendOptions } from "./xrpl-pagination";

describe("xrpl errors", () => {
  it("reads the error code of a node reply", () => {
    expect(xrplErrorCode({ error: "txnNotFound", status: "error" })).toBe("txnNotFound");
    expect(xrplErrorCode(new Error("Request timed out"))).toBeNull();
    expect(xrplErrorCode(null)).toBeNull();
  });

  it("tells missing objects from network failures", () => {
    expect(isNotFoundError({ error: "txnNotFound" })).toBe(true);
    expect(isNotFoundError({ error: "lgrNotFound" })).toBe(true);
    expect(isNotFoundError({ error: "actNotFound" })).toBe(true);
    expect(isNotFoundError({ error: "objectNotFound" })).toBe(true);
    expect(isNotFoundError({ error: "slowDown" })).toBe(false);
    expect(isNotFoundError(new Error("Request timed out"))).toBe(false);
  });

  it("recognises an aborted request", () => {
    const ac = new AbortController();
    ac.abort();
    expect(isAbortError(ac.signal.reason)).toBe(true);
    expect(isAbortError(new Error("Request timed out"))).toBe(false);
    expect(isAbortError({ error: "txnNotFound" })).toBe(false);
  });
});

describe("sendConfirmingNotFound", () => {
  const cmd = { command: "tx", transaction: "AB" };

  /** A send whose main node and full-history node answer differently. */
  function mockSend(main: () => Promise<unknown>, full: () => Promise<unknown>) {
    return vi.fn((_c: Record<string, unknown>, opts?: SendOptions) =>
      opts?.fullHistory ? full() : main(),
    );
  }

  it("returns the main node's answer without asking again", async () => {
    const send = mockSend(async () => ({ hash: "AB" }), async () => ({}));
    await expect(sendConfirmingNotFound(send, cmd)).resolves.toEqual({ hash: "AB" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("re-asks the full-history node when the main node says not found", async () => {
    const send = mockSend(
      () => Promise.reject({ error: "txnNotFound" }),
      async () => ({ hash: "AB" }),
    );
    await expect(sendConfirmingNotFound(send, cmd, { timeoutMs: 5 })).resolves.toEqual({
      hash: "AB",
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).toEqual({ timeoutMs: 5, fullHistory: true });
  });

  it("believes not-found from the full-history node", async () => {
    const send = mockSend(
      () => Promise.reject({ error: "txnNotFound" }),
      () => Promise.reject({ error: "txnNotFound" }),
    );
    await expect(sendConfirmingNotFound(send, cmd)).rejects.toEqual({ error: "txnNotFound" });
  });

  it("surfaces a full-history network failure as retryable, not not-found", async () => {
    const send = mockSend(
      () => Promise.reject({ error: "lgrNotFound" }),
      () => Promise.reject(new Error("Request timed out")),
    );
    const err = await sendConfirmingNotFound(send, cmd).catch((e) => e);
    expect(isNotFoundError(err)).toBe(false);
  });

  it("doesn't re-ask on other errors", async () => {
    const send = mockSend(() => Promise.reject({ error: "slowDown" }), async () => ({}));
    await expect(sendConfirmingNotFound(send, cmd)).rejects.toEqual({ error: "slowDown" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
