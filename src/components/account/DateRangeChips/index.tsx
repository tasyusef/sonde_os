"use client";

/**
 * DateRangeChips — preset chips + inline custom date inputs for the
 * account-page transaction list. Pure controlled component; the parent
 * owns state and URL sync.
 *
 * Six preset chips (24h, 7d, 30d, 90d, 1y, All) plus a "Custom" entry
 * route through the shared `<Toggle>` primitive so the active background
 * animates between selections. Custom expands two native `<input type=
 * "date">` fields below the strip — no modal, no separate apply button.
 * When the user picks two valid dates the filter applies on the second
 * pick.
 *
 * Why native date inputs: touch-friendly, no third-party calendar widget,
 * and the OS's own picker is what Tim flagged as "smooth not clunky"
 * compared to bespoke modal+apply UIs.
 */

import { useEffect, useRef } from "react";
import ResponsiveSelect from "@/components/shared/ResponsiveSelect";
import { type RangeKey } from "@/lib/account-tx-range";

export type ChipValue = RangeKey | "custom";

const PRESET_OPTIONS: { value: ChipValue; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "1y", label: "1y" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

interface Props {
  /** Currently active chip — either a preset key or `custom`. */
  value: ChipValue;
  /** Custom-range from date as `YYYY-MM-DD`. Only consulted when
   *  `value === "custom"`. */
  customFrom: string;
  /** Custom-range to date as `YYYY-MM-DD`. */
  customTo: string;
  onChange: (next: { value: ChipValue; from?: string; to?: string }) => void;
}

const todayUTC = (): string => new Date().toISOString().slice(0, 10);

const daysAgoUTC = (n: number): string => {
  const d = new Date(Date.now() - n * 86_400_000);
  return d.toISOString().slice(0, 10);
};

export default function DateRangeChips({
  value,
  customFrom,
  customTo,
  onChange,
}: Props) {
  // When the user first switches to "custom" without pre-existing dates,
  // seed the inputs with the resolved range of the previous preset so the
  // filter doesn't blink to "everything" while they pick. Default to a
  // 30-day window ending today (matches DEFAULT_RANGE), which the user
  // can then narrow.
  const seededRef = useRef(false);
  useEffect(() => {
    if (value !== "custom") {
      seededRef.current = false;
      return;
    }
    if (seededRef.current) return;
    seededRef.current = true;
    if (!customFrom || !customTo) {
      onChange({
        value: "custom",
        from: customFrom || daysAgoUTC(30),
        to: customTo || todayUTC(),
      });
    }
  }, [value, customFrom, customTo, onChange]);

  const handleToggle = (next: ChipValue) => {
    if (next === "custom") {
      onChange({
        value: "custom",
        from: customFrom || daysAgoUTC(30),
        to: customTo || todayUTC(),
      });
      return;
    }
    onChange({ value: next });
  };

  const handleFromChange = (next: string) => {
    onChange({ value: "custom", from: next, to: customTo });
  };

  const handleToChange = (next: string) => {
    onChange({ value: "custom", from: customFrom, to: next });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-label uppercase tracking-header text-muted">
          Activity
        </span>
        <ResponsiveSelect
          options={PRESET_OPTIONS}
          active={value}
          onChange={handleToggle}
          ariaLabel="Date range"
          desktopVariant="select"
        />
      </div>

      {value === "custom" && (
        <div
          role="group"
          aria-label="Custom date range"
          className="flex flex-wrap items-center gap-2"
        >
          <DateInput
            label="From"
            value={customFrom}
            onChange={handleFromChange}
            max={customTo || todayUTC()}
          />
          <span aria-hidden="true" className="font-mono text-label text-muted">
            →
          </span>
          <DateInput
            label="To"
            value={customTo}
            onChange={handleToChange}
            min={customFrom || undefined}
            max={todayUTC()}
          />
        </div>
      )}
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="sr-only">{label} date</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-elevated bg-elevated px-2 py-1 font-mono text-label text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      />
    </label>
  );
}

