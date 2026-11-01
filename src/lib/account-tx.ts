import type { SendFn } from "./xrpl-pagination";
import type { AccountTxResult } from "@/types/xrpl";

export type AccountTx = AccountTxResult["transactions"][number];

/** Rows per `account_tx` request. */
export const TX_PAGE_SIZE = 50;

export interface AccountTxPage {
  items: AccountTx[];
  /** Next (older) page; undefined at the start of history. */
  marker?: unknown;
}

/** One page of an account's validated history, newest first. */
export async function fetchAccountTxPage(
  send: SendFn,
  account: string,
  marker?: unknown,
): Promise<AccountTxPage> {
  const res = (await send({
    command: "account_tx",
    account,
    ledger_index_min: -1,
    ledger_index_max: -1,
    limit: TX_PAGE_SIZE,
    ...(marker === undefined ? {} : { marker }),
  })) as Partial<AccountTxResult>;
  return { items: res.transactions ?? [], marker: res.marker ?? undefined };
}
