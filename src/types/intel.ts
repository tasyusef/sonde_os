import { z } from "zod";

/* ── Visualization schema for AI-generated charts ── */

export const VisualizationSchema = z.object({
  type: z.enum(["line", "area", "bar", "pie", "scatter"]),
  title: z.string().min(1).max(200),
  data: z.array(z.record(z.unknown())).min(1).max(500),
  series: z
    .array(
      z.object({
        dataKey: z.string(),
        label: z.string(),
        color: z.string().optional(),
      }),
    )
    .min(1)
    .max(16),
  xAxis: z
    .object({
      dataKey: z.string(),
      label: z.string().optional(),
      type: z.enum(["number", "category"]).optional(),
    })
    .optional(),
  yAxis: z.object({ label: z.string().optional() }).optional(),
  /**
   * When true on an "area" type, render with stackId so series stack
   * vertically — the canonical "share-of-whole over time" view. Only
   * meaningful for `type === "area"` with 2+ series.
   */
  stacked: z.boolean().optional(),
});

export type Visualization = z.infer<typeof VisualizationSchema>;

/* ── Stat block: single-value answer ── */

export interface StatValue {
  /** Display label, e.g. "Active Accounts" */
  label: string;
  /** Numeric value. Strings only if format is "raw". */
  value: number | string;
  /** Hint for client-side formatting. "drops" → ÷ 1e6 + " XRP" suffix. */
  format?: "number" | "drops" | "percent" | "raw";
}

/* ── Table data: multi-row tabular answer ── */

export interface TableData {
  columns: Array<{ key: string; label: string }>;
  rows: Record<string, unknown>[];
  /** Total available rows (rows.length may be capped for display). */
  total: number;
}
