/**
 * /asktheledger query history helpers — write a row after each
 * successful query, read recent entries for the "Recent" rail above
 * the chat empty state.
 *
 * Errors on write are logged but not thrown — history is a UX
 * convenience, not part of the query response contract.
 */

import "server-only";
import { sql, eq, desc, and } from "drizzle-orm";
import { db } from "@/db";
import { asktheledgerHistory } from "@/db/schema";
import logger from "@/lib/logger";
import type { Visualization, StatValue, TableData } from "@/types/intel";

const log = logger.child({ module: "asktheledger-history" });

export interface HistoryEntry {
  id: number;
  question: string;
  answer: string;
  store: string | null;
  query: string | null;
  visualization: Visualization | null;
  statValue: StatValue | null;
  tableData: TableData | null;
  createdAt: string; // ISO timestamp
}

interface RecordParams {
  userAddress: string;
  question: string;
  answer: string;
  store?: string | null;
  query?: string | null;
  visualization?: Visualization | null;
  statValue?: StatValue | null;
  tableData?: TableData | null;
}

/** Append a history entry. Fire-and-forget — errors are logged, not rethrown. */
export async function recordHistoryEntry(params: RecordParams): Promise<void> {
  try {
    await db.insert(asktheledgerHistory).values({
      userAddress: params.userAddress,
      question: params.question,
      answer: params.answer,
      store: params.store ?? null,
      query: params.query ?? null,
      visualization: params.visualization ?? null,
      statValue: params.statValue ?? null,
      tableData: params.tableData ?? null,
    });
  } catch (err) {
    log.warn({ err, address: params.userAddress }, "Failed to record history entry");
  }
}

/** Most-recent-first list of history entries for a user. */
export async function getRecentHistory(
  userAddress: string,
  limit = 20,
): Promise<HistoryEntry[]> {
  try {
    const rows = await db
      .select()
      .from(asktheledgerHistory)
      .where(eq(asktheledgerHistory.userAddress, userAddress))
      .orderBy(desc(asktheledgerHistory.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      store: r.store,
      query: r.query,
      visualization: r.visualization as Visualization | null,
      statValue: r.statValue as StatValue | null,
      tableData: r.tableData as TableData | null,
      createdAt: r.createdAt.toISOString(),
    }));
  } catch (err) {
    log.warn({ err, address: userAddress }, "Failed to load recent history");
    return [];
  }
}

/** Delete a single history entry. Scoped to the user's own rows so a
 *  user cannot delete another user's history by guessing IDs. Returns
 *  the number of rows removed (0 if not found / not owned). */
export async function deleteHistoryEntry(
  userAddress: string,
  id: number,
): Promise<number> {
  try {
    const removed = await db
      .delete(asktheledgerHistory)
      .where(
        and(
          eq(asktheledgerHistory.id, id),
          eq(asktheledgerHistory.userAddress, userAddress),
        ),
      )
      .returning({ id: asktheledgerHistory.id });
    return removed.length;
  } catch (err) {
    log.warn({ err, address: userAddress, id }, "Failed to delete history entry");
    return 0;
  }
}

/** For ops: trim a single user's history to keep at most N rows. Not
 *  scheduled today — call manually if a user's history grows unwieldy. */
export async function trimHistory(userAddress: string, keep = 200): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM asktheledger_history
    WHERE user_address = ${userAddress}
      AND id NOT IN (
        SELECT id FROM asktheledger_history
        WHERE user_address = ${userAddress}
        ORDER BY created_at DESC
        LIMIT ${keep}
      )
  `);
  return Number(result.count ?? 0);
}
