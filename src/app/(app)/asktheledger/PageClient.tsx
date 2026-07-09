"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageHero from "@/components/shared/PageHero";
import TipTour from "@/components/tips/TipTour";
import TipsButton from "@/components/tips/TipsButton";
import type { TipStep } from "@/components/tips/types";
import type { Visualization, StatValue, TableData } from "@/types/intel";
import type { HistoryEntry } from "@/lib/asktheledger-history";
import ChatColumn from "./_components/ChatColumn";
import HistoryRail from "./_components/HistoryRail";
import MobileHistory from "./_components/MobileHistory";
import type { Message, Phase } from "./_components/types";

const ASKLEDGER_TIPS: TipStep[] = [
  {
    id: "intro",
    title: "Ask the ledger anything.",
    body: "Type a question in plain English — \"top smart-money traders by ROI\", \"which wallets bought RLUSD this week\". Sonde writes the query against the indexed XRPL data and returns a chart, table, or stat.",
    target: "[data-tip='ask-hero']",
    placement: "bottom",
  },
  {
    id: "input",
    title: "Just type and send.",
    body: "Questions stream back as the query runs — you'll see the phase (parsing, querying, answering) before the result lands. Each response shows the ClickHouse SQL it generated, so you can audit or copy it.",
    target: "[data-tip='ask-input']",
    placement: "top",
  },
  {
    id: "history",
    title: "Past conversations.",
    body: "Every question saves to your history. Re-open one to reload the answer without re-querying, or delete to clean up.",
    target: "[data-tip='ask-history']",
    placement: "left",
  },
];

export default function AskChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<number | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatTopRef = useRef<HTMLDivElement>(null);
  const lastScrolledUserMsgIdRef = useRef<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  const fetchHistory = useCallback(() => {
    fetch("/api/asktheledger/history")
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((data: { entries?: HistoryEntry[] }) => {
        setHistory(data.entries ?? []);
      })
      .catch(() => {
        /* silent — history is UX, not blocking */
      });
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  /** Open a past Q+A in the chat without re-running the query. */
  const loadHistoryEntry = useCallback((entry: HistoryEntry) => {
    setMessages([
      {
        id: crypto.randomUUID(),
        role: "user",
        content: entry.question,
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: entry.answer,
        store: (entry.store as Message["store"]) ?? undefined,
        query: entry.query ?? undefined,
        visualization: entry.visualization,
        statValue: entry.statValue,
        tableData: entry.tableData,
      },
    ]);
    setActiveHistoryId(entry.id);
    // Scroll to the top of the loaded conversation so the question is visible first.
    requestAnimationFrame(() => {
      chatTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setInput("");
    setPhase(null);
    setActiveHistoryId(null);
    lastScrolledUserMsgIdRef.current = null;
  }, []);

  const handleDelete = useCallback(
    async (entry: HistoryEntry) => {
      const ok = window.confirm(
        `Delete this conversation?\n\n"${entry.question}"`,
      );
      if (!ok) return;

      // Optimistic: drop from local state, mark in-flight for visual feedback.
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.add(entry.id);
        return next;
      });
      setHistory((prev) => prev.filter((h) => h.id !== entry.id));
      // If the user just deleted the chat they're viewing, clear it.
      if (activeHistoryId === entry.id) {
        setMessages([]);
        setActiveHistoryId(null);
      }

      try {
        const res = await fetch(`/api/asktheledger/history/${entry.id}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        // Revert on failure — refetch authoritative state.
        fetchHistory();
      } finally {
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(entry.id);
          return next;
        });
      }
    },
    [activeHistoryId, fetchHistory],
  );

  // Auto-scroll to bottom only when a new user message lands — i.e.
  // a fresh submission. History-replay scrolls to top instead.
  useEffect(() => {
    let lastUserId: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserId = messages[i].id;
        break;
      }
    }
    if (
      lastUserId &&
      lastUserId !== lastScrolledUserMsgIdRef.current &&
      activeHistoryId === null // only auto-scroll for fresh submits
    ) {
      lastScrolledUserMsgIdRef.current = lastUserId;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    } else if (lastUserId) {
      // Track the id even when we don't scroll, so we don't double-scroll later.
      lastScrolledUserMsgIdRef.current = lastUserId;
    }
  }, [messages, activeHistoryId]);

  const autoSubmittedRef = useRef(false);

  const handleSubmit = useCallback(
    async (question?: string) => {
      const q = question ?? input.trim();
      if (!q || loading) return;

      // Fresh question — clear any active history selection.
      setActiveHistoryId(null);

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: q,
      };
      const assistantId = crypto.randomUUID();
      const assistantSeed: Message = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, userMsg, assistantSeed]);
      setInput("");
      setLoading(true);
      setPhase("routing");

      const updateAssistant = (patch: Partial<Message>) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
        );
      };
      const appendAssistantText = (chunk: string) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + chunk } : m,
          ),
        );
      };

      try {
        const provider = sessionStorage.getItem("sonde_intel_ai_provider") ?? "anthropic";
        const aiKey = sessionStorage.getItem(`sonde_intel_ai_key_${provider}`) ?? "";
        const res = await fetch("/api/intel/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-AI-Key": aiKey,
            "X-AI-Provider": provider,
          },
          body: JSON.stringify({ question: q }),
        });

        const ct = res.headers.get("content-type") ?? "";

        if (!res.ok && !ct.includes("text/event-stream")) {
          const data = await res.json().catch(() => ({}));
          updateAssistant({
            content: data.error ?? `Request failed (${res.status})`,
            error: data.error ?? `${res.status}`,
          });
          return;
        }

        if (ct.includes("text/event-stream")) {
          let gotAnyToken = false;
          let gotMetadata = false;
          let streamErrorMsg: string | null = null;

          await consumeSSE(res, {
            onStatus: (p) => setPhase(p),
            onToken: (text) => {
              setPhase(null);
              gotAnyToken = true;
              appendAssistantText(text);
            },
            onMetadata: (meta) => {
              gotMetadata = true;
              updateAssistant({
                store: meta.store,
                query: meta.query ?? undefined,
                visualization: meta.visualization,
                statValue: meta.statValue,
                tableData: meta.tableData,
              });
            },
            onError: (msg) => {
              streamErrorMsg = msg;
            },
          });

          if (!gotMetadata) {
            const fallback =
              streamErrorMsg ||
              (gotAnyToken
                ? "Stream ended before the answer finished. Try again."
                : "No response received. Try again.");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: gotAnyToken
                        ? `${m.content}\n\n_${fallback}_`
                        : fallback,
                      error: streamErrorMsg ?? "incomplete_stream",
                    }
                  : m,
              ),
            );
          }
        } else {
          const data = await res.json();
          updateAssistant({
            content: data.answer ?? data.error ?? "No response",
            store: data.store,
            query: data.query,
            error: data.error,
            visualization: data.visualization ?? null,
            statValue: data.statValue ?? null,
            tableData: data.tableData ?? null,
          });
        }
      } catch (err) {
        updateAssistant({
          content: `Error: ${err instanceof Error ? err.message : "Request failed"}`,
          error: "Request failed",
        });
      } finally {
        setLoading(false);
        setPhase(null);
        // Refresh the rail so the new entry appears at the top.
        fetchHistory();
      }
    },
    [input, loading, fetchHistory],
  );

  // Auto-submit if landed with ?q=… (homepage hook deep-links here this way).
  useEffect(() => {
    if (autoSubmittedRef.current) return;
    const q = searchParams.get("q");
    if (q && q.trim().length > 0) {
      autoSubmittedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guarded by autoSubmittedRef above
      handleSubmit(q);
      router.replace("/asktheledger", { scroll: false });
    }
  }, [searchParams, router, handleSubmit]);

  const hasActiveChat = messages.length > 0;

  return (
    <main>
      <div data-tip="ask-hero">
        <PageHero
          title="Ask the"
          accent="Ledger"
          subtitle="Ask questions about the XRPL in plain English."
          showDataWindow
        />
      </div>

      <div className="mx-auto max-w-container px-3 pb-6 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start lg:gap-6">
        <div className="min-w-0">
          <div className="mb-3 flex justify-end">
            <TipsButton pageId="/asktheledger" />
          </div>
          <MobileHistory
            history={history}
            activeId={activeHistoryId}
            deletingIds={deletingIds}
            onSelect={loadHistoryEntry}
            onDelete={handleDelete}
            onNewChat={handleNewChat}
            hasActiveChat={hasActiveChat}
          />
          <div data-tip="ask-input">
            <ChatColumn
              ref={chatTopRef}
              messages={messages}
              loading={loading}
              phase={phase}
              input={input}
              setInput={setInput}
              onSubmit={handleSubmit}
              messagesEndRef={messagesEndRef}
            />
          </div>
        </div>
        <div data-tip="ask-history">
          <HistoryRail
            history={history}
            activeId={activeHistoryId}
            deletingIds={deletingIds}
            onSelect={loadHistoryEntry}
            onDelete={handleDelete}
            onNewChat={handleNewChat}
            hasActiveChat={hasActiveChat}
          />
        </div>
      </div>
      <TipTour pageId="/asktheledger" steps={ASKLEDGER_TIPS} />
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  SSE stream consumer                                                */
/* ------------------------------------------------------------------ */

interface MetadataEvent {
  store: "clickhouse" | "none";
  query: string | null;
  visualization: Visualization | null;
  statValue: StatValue | null;
  tableData: TableData | null;
}

interface SSECallbacks {
  onStatus: (phase: Phase) => void;
  onToken: (text: string) => void;
  onMetadata: (meta: MetadataEvent) => void;
  onError: (msg: string) => void;
}

async function consumeSSE(res: Response, cb: SSECallbacks): Promise<void> {
  if (!res.body) {
    cb.onError("Empty response body");
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      const json = dataLine.slice(6);
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(json);
      } catch {
        continue;
      }

      switch (payload.type) {
        case "status":
          if (
            payload.phase === "routing" ||
            payload.phase === "executing" ||
            payload.phase === "formatting"
          ) {
            cb.onStatus(payload.phase);
          }
          break;
        case "token":
          if (typeof payload.text === "string") cb.onToken(payload.text);
          break;
        case "metadata":
          cb.onMetadata({
            store: (payload.store as "clickhouse" | "none") ?? "none",
            query: (payload.query as string) ?? null,
            visualization: (payload.visualization as Visualization | null) ?? null,
            statValue: (payload.statValue as StatValue | null) ?? null,
            tableData: (payload.tableData as TableData | null) ?? null,
          });
          break;
        case "error":
          cb.onError(typeof payload.error === "string" ? payload.error : "Stream error");
          break;
        case "done":
          break;
      }
    }
  }
}
