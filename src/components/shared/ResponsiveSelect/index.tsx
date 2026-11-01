import type { ReactNode } from "react";
import Toggle from "@/components/shared/Toggle";
import { cn } from "@/lib/utils";
import CustomSelect from "./CustomSelect";

export interface ResponsiveSelectOption<T extends string> {
  value: T;
  /** Plain string label used inside the dropdown's option list. Also
   *  the trigger's collapsed label when `desktopLabel` isn't provided. */
  label: string;
  /** Optional richer label for the desktop Toggle render (e.g. embed
   *  a parenthesized count that disappears on mobile). Falls back to
   *  `label` when omitted. Only used when `desktopVariant="toggle"`. */
  desktopLabel?: ReactNode;
}

interface ResponsiveSelectProps<T extends string> {
  options: ResponsiveSelectOption<T>[];
  active: T;
  onChange: (value: T) => void;
  /** ARIA label — the radio group on desktop, the listbox on mobile.
   *  The dropdown trigger is named "<ariaLabel>: <selected label>" so
   *  the visible value stays in its accessible name. */
  ariaLabel?: string;
  /** Optional class applied to the dropdown wrapper, for layout
   *  tweaks (e.g. `w-full`). */
  mobileClassName?: string;
  /** Optional class merged onto the dropdown trigger button — use to
   *  override the default 24/36px control height when the parent row
   *  is taller (e.g. sitting next to a 40px search input). */
  triggerClassName?: string;
  /**
   * Desktop rendering mode:
   * - "toggle" (default) — chip radio group at sm+, custom dropdown below sm.
   *   Best for 2-3 short-labeled options where one-click switching beats
   *   a dropdown round-trip.
   * - "select" — custom dropdown at every breakpoint. Use when 4+ options
   *   or descriptive labels would clutter the desktop header.
   */
  desktopVariant?: "toggle" | "select";
}

/**
 * ResponsiveSelect — Toggle on desktop, custom dropdown on mobile (or at
 * every breakpoint when `desktopVariant="select"`).
 *
 * The dropdown is a hand-rolled overlay rather than a native `<select>`
 * for two reasons: (1) iOS forces ≥16px font on real `<select>` elements
 * to suppress focus-zoom, which made our triggers visually heavier
 * than the surrounding Toggle/tab labels. The custom overlay sidesteps
 * that and uses the same caps label as Toggle, keeping headers visually
 * unified. (2) We get a dropdown panel we can style — the accent block
 * on the selection, a check icon — instead of the OS picker. The price is owning the
 * keyboard model, which `useListboxKeys` implements per the APG listbox.
 */
export default function ResponsiveSelect<T extends string>({
  options,
  active,
  onChange,
  ariaLabel,
  mobileClassName,
  triggerClassName,
  desktopVariant = "toggle",
}: ResponsiveSelectProps<T>) {
  const renderToggleOnDesktop = desktopVariant === "toggle";

  return (
    <>
      {renderToggleOnDesktop && (
        <div className="hidden sm:block">
          <Toggle
            options={options.map((o) => ({
              value: o.value,
              label: o.desktopLabel ?? o.label,
            }))}
            active={active}
            onChange={onChange}
            ariaLabel={ariaLabel}
          />
        </div>
      )}

      <CustomSelect
        options={options}
        active={active}
        onChange={onChange}
        ariaLabel={ariaLabel}
        className={cn(
          renderToggleOnDesktop && "sm:hidden",
          mobileClassName,
        )}
        triggerClassName={triggerClassName}
      />
    </>
  );
}
