import { describe, expect, it, vi } from "vitest";
import { fetchAccountTxPage, TX_PAGE_SIZE } from "./account-tx";
import type { SendFn } from "./xrpl-pagination";

const tx = { tx: { hash: "A" }, meta: {}, validated: true };

describe("fetchAccountTxPage", () => {
  it("asks for the newest page without a marker", async () => {
    const send = vi.fn<SendFn>(async () => ({ transactions: [tx], marker: { ledger: 5, seq: 1 } }));
    const page = await fetchAccountTxPage(send, "rX");
    expect(send).toHaveBeenCalledWith({
      command: "account_tx",
      account: "rX",
      ledger_index_min: -1,
      ledger_index_max: -1,
      limit: TX_PAGE_SIZE,
    });
    expect(page).toEqual({ items: [tx], marker: { ledger: 5, seq: 1 } });
  });

  it("passes the marker on and reports the end of history", async () => {
    const send = vi.fn<SendFn>(async () => ({}));
    const page = await fetchAccountTxPage(send, "rX", { ledger: 5, seq: 1 });
    expect(send.mock.calls[0][0]).toMatchObject({ marker: { ledger: 5, seq: 1 } });
    expect(page).toEqual({ items: [], marker: undefined });
  });
});
