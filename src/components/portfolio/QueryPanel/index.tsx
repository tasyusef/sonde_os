"use client";

import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { useSubscription } from "@/hooks/useSubscription";
import UpgradeBanner from "@/components/subscription/UpgradeBanner";
import Button from "@/components/shared/Button";
import type { Visualization } from "@/types/intel";

const ChartRenderer = lazy(() => import("@/components/intel/ChartRenderer"));

const STORAGE_KEY = "sonde-anthropic-key";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  visualization?: Visualization | null;
}

const EXAMPLES = [
  "What's my largest holding by value?",
  "How has my portfolio changed this week?",
  "Which tokens have the best unrealized PnL?",
  "Summarize my DeFi exposure",
];

export default function QueryPanel() {
  const { tier } = useSubscription();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = endRef.current?.parentElement;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const hasBYOK = (() => {
    try {
      return !!localStorage.getItem(STORAGE_KEY);
    } catch {
      return false;
    }
  })();

  // Access check: Pro gets managed access (50/mo shared bucket). BYOK is unlimited.
  const hasAccess = tier === "pro";

  if (tier === "free") {
    return (
      <UpgradeBanner tier="pro" feature="Portfolio Query">
        Ask questions about your portfolio in plain English.
      </UpgradeBanner>
    );
  }

  if (!hasAccess) {
    return (
      <div className="rounded-lg border border-elevated bg-card p-6 text-center">
        <p className="font-body text-ui text-muted">
          Subscription inactive. Upgrade to Pro to use Portfolio Query.
        </p>
      </div>
    );
  }

  async function handleSend(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: msg,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      // Attach BYOK key if available
      if (hasBYOK) {
        try {
          const key = localStorage.getItem(STORAGE_KEY);
          if (key) headers["x-anthropic-api-key"] = key;
        } catch {
          // localStorage unavailable
        }
      }

      const res = await fetch("/api/portfolio/query", {
        method: "POST",
        headers,
        body: JSON.stringify({ message: msg }),
      });

      const data = await res.json();
      const reply: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.ok
          ? data.reply
          : data.error ?? "Something went wrong.",
        visualization: res.ok ? (data.visualization ?? null) : null,
      };
      setMessages((prev) => [...prev, reply]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Network error. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!hasAccess) return null;

  return (
    <div className="flex flex-col gap-4">
      {/* Messages */}
      <div className="flex min-h-[300px] max-h-[60vh] flex-col gap-3 overflow-y-auto rounded-lg border border-elevated bg-card p-4">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            <p className="font-body text-ui text-muted">
              Ask anything about your portfolio
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => handleSend(ex)}
                  className="rounded-lg border border-elevated bg-surface px-3 py-1.5 font-body text-label text-muted transition-colors hover:border-brand/30 hover:text-primary"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={
              msg.role === "user"
                ? "ml-auto max-w-[80%] flex flex-col items-end gap-2"
                : "mr-auto max-w-[90%] flex flex-col items-start gap-2"
            }
          >
            <div
              className={
                msg.role === "user"
                  ? "rounded-lg bg-brand/10 px-4 py-2.5"
                  : "rounded-lg bg-elevated px-4 py-2.5"
              }
            >
              <p className="whitespace-pre-wrap font-body text-ui text-primary">
                {msg.content}
              </p>
            </div>
            {msg.visualization && (
              <div className="w-full rounded-lg border border-elevated bg-surface p-3">
                <Suspense fallback={<div className="h-64 animate-pulse rounded bg-elevated/50" />}>
                  <ChartRenderer viz={msg.visualization} />
                </Suspense>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="mr-auto max-w-[80%] rounded-lg bg-elevated px-4 py-2.5">
            <span className="inline-block h-4 w-4 animate-pulse rounded-full bg-muted/30" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your portfolio..."
          disabled={loading}
          className="flex-1 rounded-lg border border-elevated bg-surface px-4 py-2.5 font-body text-ui text-primary placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-50"
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={loading}
          disabled={!input.trim()}
        >
          Send
        </Button>
      </form>
    </div>
  );
}
