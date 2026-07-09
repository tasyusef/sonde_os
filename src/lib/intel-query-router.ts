/**
 * LLM-powered query router — takes a natural language question,
 * generates a ClickHouse SQL query, executes it, and returns a
 * formatted answer.
 *
 * Pre-2026-04-30 the router could also target Neo4j; that store was
 * removed alongside the Neo4j cut. Routing is now CH-or-nothing — the
 * `store` field stays for response-shape compat but only takes
 * 'clickhouse' or 'none'. See `docs/plans/neo4j-removal.md`.
 */

import "server-only";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import logger from "./logger";
import { STORE_DESCRIPTIONS } from "./intel-schemas";
import { readOnlyQuery as chReadOnlyQuery } from "./clickhouse-client";
import { createCompletion, createCompletionStream, supportsStreaming, type AiUsage } from "./intel-ai-provider";
import { getDefaultModel } from "./ai-models";
import { buildQueryRouterPrompt, buildQueryFormatterPrompt, buildAgenticPrompt } from "./ai-prompts";
import { buildChartFromRows, detectStatValue, detectTableData } from "./ai-chart-builder";
import type { Visualization, StatValue, TableData } from "@/types/intel";
import type { AiProvider } from "@/components/intel/IntelligenceContext";

const log = logger.child({ module: "intel-query" });

/** Maximum rows returned from any query */
const MAX_ROWS = 100;

/**
 * Replace single- and double-quoted string literals with empty quotes.
 * Used before scanning for SQL write keywords so a literal like
 * `'delete'` inside a WHERE clause doesn't false-positive as a DELETE
 * statement. Preserves overall SQL structure (commas, parens, length-
 * sensitive errors are still meaningful) while neutralizing the contents.
 */
function stripStringLiterals(sql: string): string {
  return sql
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * Extract a JSON object from a possibly-messy LLM response.
 * Handles markdown code fences, leading preamble, and trailing text.
 * Returns the input unchanged if no object-like substring is found.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  const stripped = fenced ? fenced[1].trim() : trimmed;
  const start = stripped.indexOf("{");
  if (start === -1) return stripped;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return stripped.slice(start);
}

/**
 * Schema for the LLM router's structured output. The model is prompted
 * to return {store, query, params, explanation}; this is the runtime
 * gate that catches malformed responses before downstream code touches
 * `routing.query` and trips on undefined.
 */
const RoutingSchema = z.object({
  store: z.enum(["clickhouse", "none"]),
  query: z.string(),
  params: z.record(z.unknown()),
  explanation: z.string(),
});
type Routing = z.infer<typeof RoutingSchema>;

function parseRouting(
  text: string,
): { ok: true; routing: Routing } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const result = RoutingSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: `Schema validation failed: ${result.error.message}` };
  }
  return { ok: true, routing: result.data };
}

interface QueryOptions {
  provider: AiProvider;
  apiKey: string;
}

interface QueryResult {
  answer: string;
  store: "clickhouse" | "none";
  query: string;
  rawResults: unknown[];
  usage: AiUsage;
  /** Model ID actually used for this query (surfaced for usage tracking). */
  model: string;
  error?: string;
}

/**
 * Internal: do the routing decision + (if needed) execute the query.
 * Returns either a "complete" result (early exits — parse fail, store=none,
 * query error, empty results) or a "ready" handle with rawResults to format.
 *
 * Shared between routeQuery (non-streaming) and routeQueryStreaming.
 */
type RouteAndExecuteResult =
  | { status: "complete"; result: QueryResult }
  | {
      status: "ready";
      rawResults: unknown[];
      routing: Routing;
      routingUsage: AiUsage;
      modelUsed: string;
    };

async function routeAndExecute(
  question: string,
  opts: QueryOptions,
): Promise<RouteAndExecuteResult> {
  const totalUsage: AiUsage = { inputTokens: 0, outputTokens: 0 };

  // No prefill: Sonnet 4+ rejects assistant message prefill ("This model
  // does not support assistant message prefill"). extractJson() below
  // handles markdown-fenced output reliably across all models.
  //
  // maxTokens 2048 (raised from 1024 2026-05-04): complex multi-CTE
  // queries — comparisons, AMM TVL approximations — can run ~1.5KB in
  // SQL alone, which truncates the JSON envelope at 1024 and tripped
  // the parse-fail path with a misleading "I couldn't understand"
  // message. 2048 leaves headroom and the formatter still handles the
  // truncation case if it's reached.
  const routingCompletion = await createCompletion({
    provider: opts.provider,
    apiKey: opts.apiKey,
    maxTokens: 2048,
    system: buildQueryRouterPrompt(STORE_DESCRIPTIONS),
    messages: [{ role: "user", content: `<user_question>${question}</user_question>` }],
  });
  let routingText = routingCompletion.text;
  totalUsage.inputTokens += routingCompletion.usage.inputTokens;
  totalUsage.outputTokens += routingCompletion.usage.outputTokens;
  const modelUsed = routingCompletion.model;

  let routing: Routing;
  let firstError: string;
  const firstParse = parseRouting(routingText);
  if (firstParse.ok) {
    routing = firstParse.routing;
  } else {
    firstError = firstParse.error;
    // One-shot retry: nudge the model to output JSON only. The most
    // common failure is a prose preamble ("Sure! Here's the query:")
    // wrapping a JSON object that extractJson can usually rescue, but
    // genuine prose-only responses for fuzzy questions ("what's the
    // TVL?") slip through. The retry forces the model to commit to a
    // JSON-shaped answer — even {store:"none", explanation:"..."} is
    // strictly more useful than the parse-fail dead-end.
    const retryCompletion = await createCompletion({
      provider: opts.provider,
      apiKey: opts.apiKey,
      maxTokens: 2048,
      system: buildQueryRouterPrompt(STORE_DESCRIPTIONS),
      messages: [
        { role: "user", content: `<user_question>${question}</user_question>` },
        { role: "assistant", content: routingText },
        {
          role: "user",
          content:
            "Your previous response wasn't valid JSON. Respond again with ONLY a JSON object matching the schema {store, query, params, explanation}. No prose, no markdown fencing. If the question can't be answered with the available data, set store to \"none\" and put your reasoning in `explanation`.",
        },
      ],
    });
    routingText = retryCompletion.text;
    totalUsage.inputTokens += retryCompletion.usage.inputTokens;
    totalUsage.outputTokens += retryCompletion.usage.outputTokens;

    const secondParse = parseRouting(routingText);
    if (!secondParse.ok) {
      log.warn(
        { routingText, parseError: secondParse.error, firstErr: firstError },
        "Failed to parse routing response after retry",
      );
      return {
        status: "complete",
        result: {
          answer:
            "I couldn't understand how to process that question. Try rephrasing it.",
          store: "none",
          query: "",
          rawResults: [],
          usage: totalUsage,
          model: modelUsed,
          error: "Failed to parse routing decision (after retry)",
        },
      };
    }
    routing = secondParse.routing;
  }

  if (routing.store === "none") {
    return {
      status: "complete",
      result: {
        answer: routing.explanation || "This question can't be answered with the available data.",
        store: "none",
        query: "",
        rawResults: [],
        usage: totalUsage,
        model: modelUsed,
      },
    };
  }

  let rawResults: unknown[] = [];
  let queryError: string | undefined;

  try {
    const CH_WRITE = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|CALL|SYSTEM|ATTACH|DETACH|RENAME|OPTIMIZE|INTO\s+OUTFILE)\b/i;
    if (routing.store === "clickhouse") {
      // Strip quoted string literals before keyword scanning so legitimate
      // SQL like `WHERE change_type != 'delete'` doesn't trip the
      // write-protection regex on a string-literal "DELETE". Identifier
      // backticks are left alone — keywords inside `column_name` would be
      // a column name, not a SQL action, and our regex still flags them
      // out of an abundance of caution but those don't appear in real
      // generated queries.
      const sqlForScan = stripStringLiterals(routing.query);
      if (CH_WRITE.test(sqlForScan)) throw new Error("Write operations are not allowed");
      if (/[`"]?system[`"]?\s*\.\s*[`"]?\w+/i.test(sqlForScan)) throw new Error("System table access is not allowed");
      if (sqlForScan.includes(";")) throw new Error("Multi-statement queries are not allowed");
      if (!/\bLIMIT\b/i.test(sqlForScan)) routing.query += ` LIMIT ${MAX_ROWS}`;
      rawResults = await chReadOnlyQuery(routing.query, routing.params);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, store: routing.store, query: routing.query }, "Query execution failed");
    queryError = msg;
  }

  if (queryError) {
    return {
      status: "complete",
      result: {
        answer: "The query could not be executed. Try rephrasing your question.",
        store: routing.store,
        query: routing.query,
        rawResults: [],
        usage: totalUsage,
        model: modelUsed,
        error: queryError,
      },
    };
  }

  if (rawResults.length === 0) {
    return {
      status: "complete",
      result: {
        answer: `No results found. The query returned empty results.\n\nQuery used (${routing.store}):\n\`\`\`\n${routing.query}\n\`\`\``,
        store: routing.store,
        query: routing.query,
        rawResults: [],
        usage: totalUsage,
        model: modelUsed,
      },
    };
  }

  return {
    status: "ready",
    rawResults,
    routing,
    routingUsage: totalUsage,
    modelUsed,
  };
}

/* ------------------------------------------------------------------ */
/*  Streaming events emitted by routeQueryStreaming                    */
/* ------------------------------------------------------------------ */

export type RouteStreamEvent =
  | { type: "status"; phase: "routing" | "executing" | "formatting" }
  | { type: "token"; text: string }
  | {
      type: "metadata";
      store: "clickhouse" | "none";
      query: string;
      answer: string;
      visualization: Visualization | null;
      statValue: StatValue | null;
      tableData: TableData | null;
      usage: AiUsage;
      model: string;
    }
  | { type: "error"; error: string };

/**
 * Streaming variant of routeQuery: yields phase-status events,
 * progressive token deltas while the formatting AI call generates,
 * and a final metadata event with the structured payload.
 *
 * Provider must support streaming (Anthropic only as of 2026-05-03).
 * Caller should check supportsStreaming() before invoking — otherwise
 * the first formatting yield throws.
 *
 * The `metadata` event carries the FULL accumulated answer text +
 * cumulative usage so callers can persist history + log usage in one
 * place after the stream closes.
 */
export async function* routeQueryStreaming(
  question: string,
  opts: QueryOptions,
): AsyncIterable<RouteStreamEvent> {
  if (!supportsStreaming(opts.provider)) {
    yield {
      type: "error",
      error: `Streaming is not supported for provider: ${opts.provider}`,
    };
    return;
  }

  // Anthropic-only: agentic loop with tool use. Lets the model run
  // multiple queries (e.g. "now" + "6mo ago" for growth questions)
  // before writing the final answer in the same streaming pass — no
  // separate formatter call. Other providers fall through to the
  // legacy single-shot router below.
  if (opts.provider === "anthropic") {
    yield* routeQueryAgentic(question, opts);
    return;
  }

  yield { type: "status", phase: "routing" };

  const phase1 = await routeAndExecute(question, opts);
  if (phase1.status === "complete") {
    // Early-exit cases (routing parse fail, store=none, query error,
    // empty results) — emit the static answer as a single token, then
    // metadata, then return. No streaming AI call.
    yield { type: "token", text: phase1.result.answer };
    yield {
      type: "metadata",
      store: phase1.result.store,
      query: phase1.result.query,
      answer: phase1.result.answer,
      visualization: null,
      statValue: null,
      tableData: null,
      usage: phase1.result.usage,
      model: phase1.result.model,
    };
    return;
  }

  yield { type: "status", phase: "formatting" };

  const totalUsage: AiUsage = { ...phase1.routingUsage };
  let answer = "";

  try {
    for await (const delta of createCompletionStream({
      provider: opts.provider,
      apiKey: opts.apiKey,
      maxTokens: 2048,
      system: buildQueryFormatterPrompt(),
      messages: [
        {
          role: "user",
          content: `<user_question>${question}</user_question>\n\n<query_results store="${phase1.routing.store}" rows="${phase1.rawResults.length}">\n${JSON.stringify(phase1.rawResults.slice(0, 50))}\n</query_results>`,
        },
      ],
    })) {
      if (delta.type === "text") {
        answer += delta.text;
        yield { type: "token", text: delta.text };
      } else if (delta.type === "usage") {
        totalUsage.inputTokens += delta.usage.inputTokens;
        totalUsage.outputTokens += delta.usage.outputTokens;
      }
    }
  } catch (err) {
    yield {
      type: "error",
      error: err instanceof Error ? err.message : "Streaming error",
    };
    return;
  }

  if (!answer) answer = "Unable to format results.";

  // Detect chart / stat / table from the now-available rawResults.
  // Same priority as the non-streaming path: chart > stat > table.
  let visualization: Visualization | null = null;
  let statValue: StatValue | null = null;
  let tableData: TableData | null = null;
  try {
    const rows = phase1.rawResults as Record<string, unknown>[];
    visualization = buildChartFromRows(rows, {
      titleHint: question.length <= 80 ? question : undefined,
    });
    if (!visualization) {
      statValue = detectStatValue(rows);
      if (!statValue) tableData = detectTableData(rows);
    }
  } catch (err) {
    log.warn({ err }, "Result shape detection failed in streaming path");
  }

  yield {
    type: "metadata",
    store: phase1.routing.store,
    query: phase1.routing.query,
    answer,
    visualization,
    statValue,
    tableData,
    usage: totalUsage,
    model: phase1.modelUsed,
  };
}

/* ------------------------------------------------------------------ */
/*  Agentic streaming router (Anthropic only)                          */
/* ------------------------------------------------------------------ */

/** Max tool calls per question. Higher than this and we're either in a
 *  retry loop or the model is being indecisive — bail and let it answer
 *  with what it has. */
const AGENTIC_MAX_ITERATIONS = 5;

/** Rows passed back to the model per tool result. We have to balance
 *  giving it enough to reason about (sums, distribution) without
 *  flooding the prompt for long aggregations. */
const AGENTIC_PREVIEW_ROWS = 30;

const CH_WRITE_RE = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|CALL|SYSTEM|ATTACH|DETACH|RENAME|OPTIMIZE|INTO\s+OUTFILE)\b/i;
const CH_SYSTEM_RE = /[`"]?system[`"]?\s*\.\s*[`"]?\w+/i;

/**
 * Tool-using agentic loop. Replaces the route-and-execute → format
 * two-shot pipeline with a single streaming pass that lets the model
 * call \`run_query\` up to \`AGENTIC_MAX_ITERATIONS\` times before
 * writing its final narrative answer in the same response.
 *
 * Why this exists: the legacy router has to fit the entire decision
 * (which tables, what SQL, all CTEs) into one shot. For "growth /
 * compare / TVL" questions that need two separate queries, the model
 * had to cram both into a single CTE, which often blew past the token
 * budget or produced fragile SQL. With tools, it just runs query 1,
 * looks at the result, runs query 2, and reconciles them in prose.
 *
 * Anthropic-only. Other providers fall through to the legacy path in
 * \`routeQueryStreaming\` above.
 */
async function* routeQueryAgentic(
  question: string,
  opts: QueryOptions,
): AsyncIterable<RouteStreamEvent> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: opts.apiKey });
  const model = getDefaultModel("anthropic");

  yield { type: "status", phase: "routing" };

  const tools: Anthropic.Tool[] = [
    {
      name: "run_query",
      description:
        "Run a read-only ClickHouse SQL query against the XRPL data store. Returns up to 100 rows. Use {paramName:Type} placeholders in the SQL and pass values in `params`. Read-only — INSERT/UPDATE/DELETE/DDL are blocked.",
      input_schema: {
        type: "object" as const,
        properties: {
          sql: {
            type: "string",
            description: "ClickHouse SQL query.",
          },
          params: {
            type: "object",
            description:
              "Parameter values for {name:Type} placeholders in the SQL. Optional.",
          },
        },
        required: ["sql"],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: question },
  ];

  const totalUsage: AiUsage = { inputTokens: 0, outputTokens: 0 };
  let answer = "";
  let lastQuery = "";
  let lastResults: unknown[] = [];
  let lastStore: "clickhouse" | "none" = "none";

  for (let iter = 0; iter < AGENTIC_MAX_ITERATIONS; iter++) {
    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: buildAgenticPrompt(STORE_DESCRIPTIONS),
      tools,
      messages,
    });

    try {
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          const text = event.delta.text;
          answer += text;
          yield { type: "token", text };
        }
      }
    } catch (err) {
      yield {
        type: "error",
        error: err instanceof Error ? err.message : "Streaming error",
      };
      return;
    }

    const finalMsg = await stream.finalMessage();
    totalUsage.inputTokens += finalMsg.usage?.input_tokens ?? 0;
    totalUsage.outputTokens += finalMsg.usage?.output_tokens ?? 0;

    const toolUses = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (finalMsg.stop_reason === "end_turn" || toolUses.length === 0) {
      break;
    }

    yield { type: "status", phase: "executing" };

    // Echo the assistant turn (text + tool_use blocks) back into the
    // conversation so the next call has full context. Anthropic accepts
    // ContentBlock[] from a prior response as ContentBlockParam[].
    messages.push({
      role: "assistant",
      content: finalMsg.content as unknown as Anthropic.ContentBlockParam[],
    });

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const tc of toolUses) {
      if (tc.name !== "run_query") {
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: tc.id,
          content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
          is_error: true,
        });
        continue;
      }

      const input = tc.input as { sql?: unknown; params?: unknown };
      const rawSql = typeof input.sql === "string" ? input.sql : "";
      const params =
        typeof input.params === "object" && input.params !== null
          ? (input.params as Record<string, unknown>)
          : {};

      let resultPayload:
        | { rows: unknown[]; row_count: number; truncated: boolean }
        | { error: string };
      try {
        if (!rawSql) throw new Error("sql is required");
        const sqlForScan = stripStringLiterals(rawSql);
        if (CH_WRITE_RE.test(sqlForScan))
          throw new Error("Write operations are not allowed");
        if (CH_SYSTEM_RE.test(sqlForScan))
          throw new Error("System table access is not allowed");
        if (sqlForScan.includes(";"))
          throw new Error("Multi-statement queries are not allowed");
        const finalSql = /\bLIMIT\b/i.test(sqlForScan)
          ? rawSql
          : `${rawSql} LIMIT ${MAX_ROWS}`;

        const rows = await chReadOnlyQuery(finalSql, params);
        lastQuery = finalSql;
        lastResults = rows;
        lastStore = "clickhouse";
        resultPayload = {
          rows: rows.slice(0, AGENTIC_PREVIEW_ROWS),
          row_count: rows.length,
          truncated: rows.length > AGENTIC_PREVIEW_ROWS,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn({ err, sql: rawSql }, "Agentic tool call failed");
        resultPayload = { error: msg };
      }

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: tc.id,
        content: JSON.stringify(resultPayload),
        is_error: "error" in resultPayload,
      });
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  if (!answer) answer = "Unable to compose an answer.";

  let visualization: Visualization | null = null;
  let statValue: StatValue | null = null;
  let tableData: TableData | null = null;
  if (lastResults.length > 0) {
    try {
      const rows = lastResults as Record<string, unknown>[];
      visualization = buildChartFromRows(rows, {
        titleHint: question.length <= 80 ? question : undefined,
      });
      if (!visualization) {
        statValue = detectStatValue(rows);
        if (!statValue) tableData = detectTableData(rows);
      }
    } catch (err) {
      log.warn({ err }, "Result shape detection failed in agentic path");
    }
  }

  yield {
    type: "metadata",
    store: lastStore,
    query: lastQuery,
    answer,
    visualization,
    statValue,
    tableData,
    usage: totalUsage,
    model,
  };
}

/**
 * Route a natural language question to the right data store,
 * generate a query, execute it, and format the answer.
 */
export async function routeQuery(question: string, opts: QueryOptions): Promise<QueryResult> {
  const phase1 = await routeAndExecute(question, opts);
  if (phase1.status === "complete") return phase1.result;

  // Format the results into a human-readable answer (non-streaming).
  const formatCompletion = await createCompletion({
    provider: opts.provider,
    apiKey: opts.apiKey,
    maxTokens: 2048,
    system: buildQueryFormatterPrompt(),
    messages: [
      {
        role: "user",
        content: `<user_question>${question}</user_question>\n\n<query_results store="${phase1.routing.store}" rows="${phase1.rawResults.length}">\n${JSON.stringify(phase1.rawResults.slice(0, 50))}\n</query_results>`,
      },
    ],
  });
  const totalUsage: AiUsage = {
    inputTokens: phase1.routingUsage.inputTokens + formatCompletion.usage.inputTokens,
    outputTokens: phase1.routingUsage.outputTokens + formatCompletion.usage.outputTokens,
  };

  return {
    answer: formatCompletion.text || "Unable to format results.",
    store: phase1.routing.store,
    query: phase1.routing.query,
    rawResults: phase1.rawResults, // Caller must not expose raw rows to clients.
    usage: totalUsage,
    model: phase1.modelUsed,
  };
}
