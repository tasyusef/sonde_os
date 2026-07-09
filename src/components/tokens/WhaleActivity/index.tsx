"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import Toggle from "@/components/shared/Toggle";
import ResponsiveSelect from "@/components/shared/ResponsiveSelect";
import InfoTip from "@/components/shared/InfoTip";
import { cn } from "@/lib/utils";

interface WhaleEvent {
  snapshotTime: string;
  holderAddress: string;
  delta: number;
  balance: number;
  type: "accumulation" | "distribution" | "new_entry" | "exit";
  highConfidence: boolean;
}

interface WhaleActivityData {
  events: WhaleEvent[];
  snapshotCount: number;
}

const PERIODS: { value: "24h" | "7d" | "30d"; label: string }[] = [
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

function eventIcon(type: WhaleEvent["type"]) {
  switch (type) {
    case "accumulation": return "↑";
    case "distribution": return "↓";
    case "new_entry": return "+";
    case "exit": return "−";
  }
}

function eventColor(type: WhaleEvent["type"]) {
  switch (type) {
    case "accumulation":
    case "new_entry":
      return "text-success";
    case "distribution":
    case "exit":
      return "text-error";
  }
}

function eventLabel(type: WhaleEvent["type"]) {
  switch (type) {
    case "accumulation": return "Accumulated";
    case "distribution": return "Distributed";
    case "new_entry": return "Entered Top 10";
    case "exit": return "Exited Top 10";
  }
}

function formatAmount(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(1)}K`;
  return abs.toFixed(2);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 1) return "< 1h ago";
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type EventFilter = "all" | "buys" | "sells";

const FILTERS: { value: EventFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "buys", label: "Buys" },
  { value: "sells", label: "Sells" },
];

export default function WhaleActivity({ currency, issuer }: { currency: string; issuer: string }) {
  const [period, setPeriod] = useState<"24h" | "7d" | "30d">("7d");
  const [filter, setFilter] = useState<EventFilter>("all");

  const { data, isLoading } = useSWR<WhaleActivityData>(
    `/api/intel/whale-activity?currency=${encodeURIComponent(currency)}&issuer=${issuer}&period=${period}`,
    (url: string) => fetch(url).then((r) => r.ok ? r.json() : null),
    { dedupingInterval: 30_000, keepPreviousData: true },
  );

  if (isLoading && !data) {
    return (
      <div className="flex h-full flex-col rounded-2xl border border-elevated bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-label font-bold uppercase tracking-header text-brand">Whale Activity</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-brand" role="status" aria-label="Loading whale activity" />
        </div>
      </div>
    );
  }

  const events = data?.events ?? [];
  const filteredEvents = filter === "all"
    ? events
    : filter === "buys"
      ? events.filter((e) => e.type === "accumulation" || e.type === "new_entry")
      : events.filter((e) => e.type === "distribution" || e.type === "exit");

  return (
    <div className="flex h-full flex-col rounded-2xl border border-elevated bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="font-display text-label font-bold uppercase tracking-header text-brand">Whale Activity</h3>
        <div className="flex flex-wrap items-center gap-2">
          <ResponsiveSelect
            options={FILTERS}
            active={filter}
            onChange={setFilter}
            ariaLabel="Whale activity filter"
          />
          <Toggle options={PERIODS} active={period} onChange={setPeriod} ariaLabel="Time period" />
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <p className="flex-1 py-6 text-center font-mono text-cell text-muted">
          No whale activity detected in this period.
        </p>
      ) : (
        // Layout note: on lg+ (the 2-column grid) we want the card height
        // bounded by its sibling Issuer Distribution, so 100 events don't
        // stretch the row — that's what `lg:relative lg:min-h-0 lg:flex-1`
        // + `lg:absolute lg:inset-0` accomplishes (the inner scroll
        // viewport is absolutely positioned and contributes 0 to the
        // parent's intrinsic height).
        //
        // On mobile (1-column, no sibling to size against), `flex-1`
        // resolves to 0px and the absolute child gets clipped invisibly.
        // So mobile uses natural flow with a viewport-height cap that
        // keeps the card scannable without dominating the page.
        <div className="lg:relative lg:min-h-0 lg:flex-1">
          <div className="space-y-2 max-h-[60vh] overflow-y-auto lg:absolute lg:inset-0 lg:max-h-none">
          {filteredEvents.map((event, i) => (
            <div
              key={`${event.holderAddress}-${event.snapshotTime}-${i}`}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-elevated px-3 py-2",
                !event.highConfidence && "opacity-60",
              )}
            >
              <span className={cn("font-mono text-value font-bold", eventColor(event.type))}>
                {eventIcon(event.type)}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/account/${event.holderAddress}`}
                    className="font-mono text-cell text-brand hover:underline"
                  >
                    {event.holderAddress.slice(0, 8)}...{event.holderAddress.slice(-4)}
                  </Link>
                  <span className={cn(
                    "rounded-tag px-2 py-0.5 font-mono text-tag font-medium",
                    event.type === "accumulation" || event.type === "new_entry"
                      ? "bg-success/10 text-success"
                      : "bg-error/10 text-error",
                  )}>
                    {eventLabel(event.type)}
                  </span>
                  {!event.highConfidence && (
                    <span className="inline-flex items-center gap-1 rounded-tag bg-chart-amber/10 px-2 py-0.5 font-mono text-tag font-medium text-chart-amber">
                      Low confidence
                      <InfoTip
                        label="Why is this low confidence?"
                        className="text-chart-amber/70 hover:text-chart-amber"
                      >
                        This event was inferred by diffing two holder
                        snapshots more than 6 hours apart. The actual
                        on-ledger movements likely happened gradually
                        within that gap, not as a single transfer —
                        treat the timing and direction as approximate.
                      </InfoTip>
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-3 font-mono text-tag text-muted">
                  <span className={eventColor(event.type)}>
                    {event.delta > 0 ? "+" : ""}{formatAmount(event.delta)}
                  </span>
                  <span>Balance: {formatAmount(event.balance)}</span>
                  <span>{timeAgo(event.snapshotTime)}</span>
                </div>
              </div>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
