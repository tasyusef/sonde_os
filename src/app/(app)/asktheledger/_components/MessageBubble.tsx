"use client";

import { useState, lazy, Suspense } from "react";
import { cn } from "@/lib/utils";
import StatRenderer from "@/components/intel/StatRenderer";
import TableRenderer from "@/components/intel/TableRenderer";
import type { Message, Phase } from "./types";
import { PHASE_LABEL } from "./types";

// Lazy-load the chart renderer — pulls in Recharts (~80 KB), don't
// want to ship it on the unauth/free render paths.
const ChartRenderer = lazy(() => import("@/components/intel/ChartRenderer"));

// ProseAnswer pulls react-markdown + remark-gfm (~30 KB). Prose
// answers only appear after the user submits a query, so eagerly
// loading the markdown stack on initial /asktheledger render is
// wasted bytes for users who haven't asked anything yet.
const ProseAnswer = lazy(() => import("@/components/intel/ProseAnswer"));

interface Props {
  message: Message;
  loading: boolean;
  phase: Phase | null;
}

export default function MessageBubble({ message, loading, phase }: Props) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "rounded-2xl px-4 py-3",
        isUser
          ? "ml-auto max-w-[85%] bg-brand/10 text-primary"
          : "max-w-full bg-elevated text-primary",
      )}
    >
      {!isUser && message.store && message.store !== "none" && (
        <div className="mb-2 flex items-center gap-2">
          <span
            className={cn(
              "rounded-tag px-2 py-0.5 font-mono text-tag font-medium",
              message.store === "clickhouse"
                ? "bg-chart-blue/10 text-chart-blue"
                : "bg-chart-emerald/10 text-chart-emerald",
            )}
          >
            {message.store}
          </span>
          {message.error && (
            <span className="rounded-tag bg-error/10 px-2 py-0.5 font-mono text-tag font-medium text-error">
              error
            </span>
          )}
        </div>
      )}

      {!isUser && message.content === "" && loading ? (
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 motion-safe:animate-pulse rounded-full bg-brand" />
          <span className="font-mono text-cell text-muted">
            {phase ? PHASE_LABEL[phase] : "Thinking…"}
          </span>
        </div>
      ) : !isUser ? (
        <Suspense
          fallback={
            <div className="font-body text-ui leading-relaxed whitespace-pre-wrap text-secondary">
              {message.content}
            </div>
          }
        >
          <ProseAnswer markdown={message.content} />
        </Suspense>
      ) : (
        <div className="font-body text-ui leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      )}

      {message.visualization ? (
        <div className="mt-4 -mx-1 rounded-xl border border-elevated bg-bg/40 p-3">
          <Suspense
            fallback={<div className="h-64 animate-pulse rounded-lg bg-elevated/40" />}
          >
            <ChartRenderer viz={message.visualization} />
          </Suspense>
        </div>
      ) : message.statValue ? (
        <div className="mt-4">
          <StatRenderer stat={message.statValue} />
        </div>
      ) : message.tableData ? (
        <div className="mt-4">
          <TableRenderer table={message.tableData} />
        </div>
      ) : null}

      {message.query && <QueryDetail query={message.query} store={message.store} />}
    </div>
  );
}

function QueryDetail({ query, store }: { query: string; store?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2 border-t border-elevated/50 pt-2">
      <button
        onClick={() => setOpen(!open)}
        className="font-mono text-label text-muted hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-sm"
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} {store ?? "generated"} query
      </button>
      {open && (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-surface p-3 font-mono text-label text-muted">
          <code>{query}</code>
        </pre>
      )}
    </div>
  );
}
