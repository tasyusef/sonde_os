"use client";

import { cn } from "@/lib/utils";

const labelClass =
  "block font-display text-label uppercase tracking-header text-muted mb-1";
const inputClass =
  "rounded-lg border border-elevated bg-elevated px-2.5 py-1 font-mono text-cell text-primary outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/50";

export function SelectControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, "cursor-pointer")}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ToggleControl({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-10 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
          checked ? "bg-brand" : "bg-elevated"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform",
            checked && "translate-x-4"
          )}
        />
      </button>
    </div>
  );
}

export function TextControl({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number";
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(inputClass, "w-full max-w-[200px]")}
      />
    </div>
  );
}

export function NumberControl({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const clamp = (v: number) => {
    if (min !== undefined && v < min) return min;
    if (max !== undefined && v > max) return max;
    return v;
  };

  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="flex items-center gap-0">
        <input
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n)) onChange(clamp(n));
          }}
          className={cn(
            inputClass,
            "w-16 rounded-r-none border-r-0 text-center tabular-nums"
          )}
        />
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={`Increase ${label}`}
            onClick={() => onChange(clamp(value + step))}
            disabled={max !== undefined && value >= max}
            className="flex h-[15px] w-7 items-center justify-center rounded-tr-lg border border-elevated bg-elevated text-muted transition-colors hover:bg-surface hover:text-primary disabled:opacity-30"
          >
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
              <path d="M1 4L4 1L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            onClick={() => onChange(clamp(value - step))}
            disabled={min !== undefined && value <= min}
            className="flex h-[15px] w-7 items-center justify-center rounded-br-lg border border-t-0 border-elevated bg-elevated text-muted transition-colors hover:bg-surface hover:text-primary disabled:opacity-30"
          >
            <svg width="8" height="5" viewBox="0 0 8 5" fill="none">
              <path d="M1 1L4 4L7 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
