import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchReachability } from "./xrpl-reachability";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("watchReachability", () => {
  it("flags unreachable when nothing connects in time", () => {
    const onChange = vi.fn();
    watchReachability(15_000, onChange);
    vi.advanceTimersByTime(14_999);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("stays quiet when a node connects first, and clears on connect", () => {
    const onChange = vi.fn();
    const reach = watchReachability(15_000, onChange);
    reach.status(true);
    vi.advanceTimersByTime(60_000);
    expect(onChange).not.toHaveBeenCalled();

    reach.status(false);
    vi.advanceTimersByTime(15_000);
    expect(onChange).toHaveBeenLastCalledWith(true);
    reach.status(true);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("restarts the clock on retry, unless already connected", () => {
    const onChange = vi.fn();
    const reach = watchReachability(15_000, onChange);
    vi.advanceTimersByTime(15_000);
    expect(reach.retry()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(false);
    vi.advanceTimersByTime(15_000);
    expect(onChange).toHaveBeenLastCalledWith(true);

    reach.status(true);
    expect(reach.retry()).toBe(false);
  });

  it("does nothing after stop", () => {
    const onChange = vi.fn();
    const reach = watchReachability(15_000, onChange);
    reach.stop();
    vi.advanceTimersByTime(60_000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
