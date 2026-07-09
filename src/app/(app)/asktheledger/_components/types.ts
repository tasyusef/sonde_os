import type { Visualization, StatValue, TableData } from "@/types/intel";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  store?: "clickhouse" | "neo4j" | "none";
  query?: string;
  error?: string;
  visualization?: Visualization | null;
  statValue?: StatValue | null;
  tableData?: TableData | null;
}

export type Phase = "routing" | "executing" | "formatting";

export const PHASE_LABEL: Record<Phase, string> = {
  routing: "Reading the question…",
  executing: "Querying the ledger…",
  formatting: "Composing answer…",
};
