import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatCardVariant = "default" | "elevated";
export type StatCardValueColor =
  | "primary"
  | "success"
  | "error"
  | "warning"
  | "muted"
  | "brand";

const VALUE_COLOR_CLASSES: Record<StatCardValueColor, string> = {
  primary: "text-primary",
  success: "text-success",
  error: "text-error",
  warning: "text-warning",
  muted: "text-muted",
  brand: "text-brand",
};

export interface StatCardProps {
  /** Uppercase mono label shown above the value. */
  label: string;
  /** Main value — usually a number, formatted externally. */
  value: ReactNode;
  /** Optional secondary text shown below the value. */
  sub?: ReactNode;
  /** Semantic color for the value. Defaults to "primary". */
  valueColor?: StatCardValueColor;
  /**
   * default — bordered + bg-surface (admin, token detail, network cards)
   * elevated — no border, bg-elevated (portfolio risk metrics, highlight cards)
   */
  variant?: StatCardVariant;
  /** Use text-heading instead of text-value for a larger metric. */
  emphasis?: boolean;
  className?: string;
}

/**
 * Universal stat card. Shows a labeled metric value with optional secondary text.
 * Use this everywhere you have a compact label + value pair in a grid.
 *
 * For trends/sparklines/charts, compose by passing JSX to `sub`.
 */
export default function StatCard({
  label,
  value,
  sub,
  valueColor = "primary",
  variant = "default",
  emphasis = false,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl p-4 shadow-card",
        variant === "default"
          ? "border border-elevated bg-surface"
          : "bg-elevated",
        className,
      )}
    >
      <p className="font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono font-medium tabular-nums",
          emphasis ? "text-heading" : "text-value",
          VALUE_COLOR_CLASSES[valueColor],
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1 font-mono text-tag text-muted">{sub}</p>
      )}
    </div>
  );
}
