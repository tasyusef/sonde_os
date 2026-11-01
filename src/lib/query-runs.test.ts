import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getQueryProgress,
  isQueryRunning,
  queryFetchedAt,
  retainQuery,
  runQuery,
  subscribeQueryProgress,
  type RunContext,
} from "./query-runs";

/** A task that waits until the test settles it. */
function deferredTask<T>() {
  const calls: RunContext[] = [];
  let settle: { resolve: (v: T) => void; reject: (e: unknown) => void } | null = null;
  const task = (ctx: RunContext) =>
    new Promise<T>((resolve, reject) => {
      calls.push(ctx);
      settle = { resolve, reject };
      ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
    });
  return { task, calls, settle: () => settle! };
}

let n = 0;
const freshId = () => `q${++n}`;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("runQuery", () => {
  it("resolves with the task's value and records when", async () => {
    const id = freshId();
    const release = retainQuery(id);
    vi.setSystemTime(1_000);
    const result = runQuery(id, async () => 42);
    expect(isQueryRunning(id)).toBe(true);
    await expect(result).resolves.toBe(42);
    expect(isQueryRunning(id)).toBe(false);
    expect(queryFetchedAt(id)).toBe(1_000);
    release();
  });

  it("aborts the run a tick after the last user leaves", async () => {
    const id = freshId();
    const release = retainQuery(id);
    const { task, calls } = deferredTask<number>();
    const result = runQuery(id, task);
    result.catch(() => {});
    release();
    expect(calls[0].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[0].signal.aborted).toBe(true);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps running when a user comes back within the tick (remount)", async () => {
    const id = freshId();
    const release = retainQuery(id);
    const { task, calls, settle } = deferredTask<number>();
    const result = runQuery(id, task);
    release();
    const again = retainQuery(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[0].signal.aborted).toBe(false);
    settle().resolve(7);
    await expect(result).resolves.toBe(7);
    again();
  });

  it("restarts an aborted run when the key is wanted again before it stops", async () => {
    const id = freshId();
    const release = retainQuery(id);
    let attempts = 0;
    let second: RunContext | null = null;
    const result = runQuery(id, (ctx) => {
      attempts++;
      if (attempts === 1) {
        // Abort lands, but the task only notices after a new user arrives.
        return new Promise((_, reject) =>
          ctx.signal.addEventListener("abort", () => {
            retainQuery(id);
            reject(ctx.signal.reason);
          }),
        );
      }
      second = ctx;
      return Promise.resolve("fresh");
    });
    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe("fresh");
    expect(attempts).toBe(2);
    expect(second!.signal.aborted).toBe(false);
  });

  it("supersedes the key's previous run", async () => {
    const id = freshId();
    const release = retainQuery(id);
    const first = deferredTask<string>();
    const older = runQuery(id, first.task);
    const newer = runQuery(id, async () => "new");
    expect(first.calls[0].signal.aborted).toBe(true);
    await expect(older).rejects.toMatchObject({ name: "AbortError" });
    await expect(newer).resolves.toBe("new");
    release();
  });

  it("doesn't return a result that finished after the abort", async () => {
    const id = freshId();
    const release = retainQuery(id);
    const result = runQuery(id, async ({ signal }) => {
      await new Promise((r) => setTimeout(r, 5));
      return signal.aborted ? "partial" : "full";
    });
    result.catch(() => {});
    release();
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("passes task errors through", async () => {
    const id = freshId();
    const release = retainQuery(id);
    await expect(runQuery(id, async () => Promise.reject({ error: "tooBusy" }))).rejects.toEqual({
      error: "tooBusy",
    });
    release();
  });
});

describe("query progress", () => {
  it("publishes partial results and clears them after the run", async () => {
    const id = freshId();
    const release = retainQuery(id);
    const seen: unknown[] = [];
    const unsubscribe = subscribeQueryProgress(id, () => seen.push(getQueryProgress(id)));
    const { task, calls, settle } = deferredTask<string>();
    const result = runQuery(id, task);
    calls[0].publish([1]);
    calls[0].publish([1, 2]);
    expect(getQueryProgress(id)).toEqual([1, 2]);
    settle().resolve("done");
    await result;
    expect(getQueryProgress(id)).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getQueryProgress(id)).toBeUndefined();
    expect(seen).toEqual([[1], [1, 2], undefined]);
    unsubscribe();
    release();
  });

  it("ignores progress from an aborted run", async () => {
    const id = freshId();
    const release = retainQuery(id);
    const { task, calls } = deferredTask<string>();
    runQuery(id, task).catch(() => {});
    release();
    await vi.advanceTimersByTimeAsync(0);
    calls[0].publish(["late"]);
    expect(getQueryProgress(id)).toBeUndefined();
  });
});
