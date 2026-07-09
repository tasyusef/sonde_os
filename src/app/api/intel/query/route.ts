import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { routeQuery, routeQueryStreaming } from "@/lib/intel-query-router";
import { supportsStreaming } from "@/lib/intel-ai-provider";
import { calculateCost } from "@/lib/ai-models";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { cookies } from "next/headers";
import { requireTier, checkAiRateLimit } from "@/lib/subscription";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { buildChartFromRows, detectStatValue, detectTableData } from "@/lib/ai-chart-builder";
import { recordHistoryEntry } from "@/lib/asktheledger-history";
import logger from "@/lib/logger";

const log = logger.child({ module: "intel/query" });

interface AiCallLog {
  userAddress: string;
  queryType: "intel_query";
  model: string;
  tokensIn: number;
  tokensOut: number;
}

async function logAiUsage(entry: AiCallLog) {
  if (entry.tokensIn <= 0 && entry.tokensOut <= 0) return;
  const cost = calculateCost(entry.model, entry.tokensIn, entry.tokensOut);
  try {
    await db.insert(aiUsage).values({
      userAddress: entry.userAddress,
      queryType: entry.queryType,
      model: entry.model,
      tokensIn: entry.tokensIn,
      tokensOut: entry.tokensOut,
      costUsd: sql`${cost.toFixed(6)}::numeric`,
    });
  } catch (err) {
    log.error({ err, entry }, "Failed to write ai_usage row");
  }
}

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-query", 10);


export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  const cookieStore = await cookies();

  let tierSession: Awaited<ReturnType<typeof requireTier>>;
  try {
    tierSession = await requireTier(cookieStore, "pro");
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Monthly rate limit (BYOK users bypass).
  try {
    await checkAiRateLimit(tierSession.address, request, "intel_query");
  } catch (e) {
    if (e instanceof Response) return e;
    logger.error({ err: e, address: tierSession.address }, "[intel/query] rate-limit check failed");
    return NextResponse.json({ error: "Internal error checking usage" }, { status: 500 });
  }

  let body: { question: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { question } = body;
  if (!question || typeof question !== "string" || question.trim().length === 0) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  if (question.length > 1000) {
    return NextResponse.json({ error: "Question too long (max 1000 chars)" }, { status: 400 });
  }

  const byokKey = request.headers.get("x-ai-key");
  const aiKey = byokKey || process.env.ANTHROPIC_API_KEY;
  const rawProvider = byokKey ? (request.headers.get("x-ai-provider") ?? "anthropic") : "anthropic";
  const aiProvider = (["anthropic", "google", "openai"].includes(rawProvider) ? rawProvider : "anthropic") as "anthropic" | "google" | "openai";

  if (!aiKey) {
    return NextResponse.json(
      { error: "AI service not configured. Set ANTHROPIC_API_KEY or add your own key in settings." },
      { status: 503 },
    );
  }

  // Streaming branch — Accept: text/event-stream + provider supports it.
  // Non-streaming providers (Google, OpenAI today) silently fall through
  // to the JSON path; the client will get back a regular response.
  const acceptsStream = request.headers.get("accept")?.includes("text/event-stream") ?? false;
  if (acceptsStream && supportsStreaming(aiProvider)) {
    return streamingResponse({
      question: question.trim(),
      provider: aiProvider,
      apiKey: aiKey,
      userAddress: tierSession.address,
    });
  }

  try {
    const result = await routeQuery(question.trim(), { provider: aiProvider, apiKey: aiKey });

    // Track the routing + formatting calls (one row covers both — same model)
    await logAiUsage({
      userAddress: tierSession.address,
      queryType: "intel_query",
      model: result.model,
      tokensIn: result.usage.inputTokens,
      tokensOut: result.usage.outputTokens,
    });

    // Deterministic shape detection from raw query rows — no LLM call.
    // Priority: chart > stat (single number) > table (tabular). Each
    // returns null when shape doesn't match, so they're mutually
    // exclusive on the client (chart wins if multiple match).
    const rows = result.rawResults as Record<string, unknown>[];
    let visualization = null;
    let statValue = null;
    let tableData = null;
    try {
      // "Share / breakdown / distribution / by type" intent → donut chart
      // (renders via the existing pie type, which already uses
      // innerRadius="50%" so it's visually a donut).
      const shareIntent = /\b(share|breakdown|distribution|by type|by category|allocation|composition|split)\b/i.test(question);
      // Always pass the user's question — the chart builder cleans it
      // (strips filler verbs, sentence-cases, reconciles "Top N" with
      // actual row count) and falls back to a canonical title from the
      // data shape if the cleaned question isn't usable.
      visualization = buildChartFromRows(rows, {
        titleHint: question.trim() || undefined,
        preferredShape: shareIntent ? "pie" : undefined,
      });
      if (!visualization) {
        statValue = detectStatValue(rows);
        if (!statValue) tableData = detectTableData(rows);
      }
    } catch (err) {
      log.warn({ err }, "Result shape detection failed");
    }

    // Append to per-user history (fire-and-forget; UX-only).
    void recordHistoryEntry({
      userAddress: tierSession.address,
      question: question.trim(),
      answer: result.answer,
      store: result.store,
      query: result.query || null,
      visualization,
      statValue,
      tableData,
    });

    // Strip rawResults from the client response — only structured shape
    // configs (chart / stat / table) leave the server.
    return NextResponse.json({
      answer: result.answer,
      store: result.store,
      query: result.query,
      visualization,
      statValue,
      tableData,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    const raw = err instanceof Error ? err.message : "Query failed";
    // Sanitize: strip any occurrence of the user's API key from error messages
    const message = aiKey ? raw.replaceAll(aiKey, "[REDACTED]") : raw;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ------------------------------------------------------------------ */
/*  Streaming response                                                 */
/* ------------------------------------------------------------------ */

interface StreamingArgs {
  question: string;
  provider: "anthropic" | "google" | "openai";
  apiKey: string;
  userAddress: string;
}

function streamingResponse(args: StreamingArgs): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        for await (const ev of routeQueryStreaming(args.question, {
          provider: args.provider,
          apiKey: args.apiKey,
        })) {
          send(ev);
          if (ev.type === "metadata") {
            // Persist + log after the answer is fully composed.
            void logAiUsage({
              userAddress: args.userAddress,
              queryType: "intel_query",
              model: ev.model,
              tokensIn: ev.usage.inputTokens,
              tokensOut: ev.usage.outputTokens,
            });
            void recordHistoryEntry({
              userAddress: args.userAddress,
              question: args.question,
              answer: ev.answer,
              store: ev.store,
              query: ev.query || null,
              visualization: ev.visualization,
              statValue: ev.statValue,
              tableData: ev.tableData,
            });
          }
        }
        send({ type: "done" });
      } catch (err) {
        const raw = err instanceof Error ? err.message : "Stream failed";
        const message = args.apiKey ? raw.replaceAll(args.apiKey, "[REDACTED]") : raw;
        log.error({ err: message }, "[intel/query] streaming generator failed");
        send({ type: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      // Caddy + cloudflared both heuristically buffer responses without this hint.
      "X-Accel-Buffering": "no",
    },
  });
}
