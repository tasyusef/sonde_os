import PixelIcon from "@/components/shared/PixelIcon";
import { cn } from "@/lib/utils";

const labelClass =
  "block font-display text-caps uppercase tracking-header text-muted mb-1";
const inputClass =
  "border border-line bg-surface px-2.5 py-1 font-mono text-cell text-primary";

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
          "relative h-6 w-10 rounded-full",
          checked ? "bg-accent" : "bg-elevated"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white",
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
            "w-16 border-r-0 text-center tabular-nums"
          )}
        />
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={`Increase ${label}`}
            onClick={() => onChange(clamp(value + step))}
            disabled={max !== undefined && value >= max}
            className="flex h-[15px] w-7 items-center justify-center border border-line bg-surface text-muted enabled:hover:bg-primary enabled:hover:text-black disabled:opacity-30"
          >
            <PixelIcon name="chevron-up" size="sm" />
          </button>
          <button
            type="button"
            aria-label={`Decrease ${label}`}
            onClick={() => onChange(clamp(value - step))}
            disabled={min !== undefined && value <= min}
            className="flex h-[15px] w-7 items-center justify-center border border-t-0 border-line bg-surface text-muted enabled:hover:bg-primary enabled:hover:text-black disabled:opacity-30"
          >
            <PixelIcon name="chevron-down" size="sm" />
          </button>
        </div>
      </div>
    </div>
  );
}
