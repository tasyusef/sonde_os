"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import Button, { type ButtonVariant, type ButtonSize } from "@/components/shared/Button";
import { cn } from "@/lib/utils";

export interface DropdownItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

interface DropdownMenuProps {
  /** Trigger button label. Rendered as a Button with a chevron. */
  triggerLabel: ReactNode;
  /** Button variant for the trigger. */
  triggerVariant?: ButtonVariant;
  /** Button size for the trigger. */
  triggerSize?: ButtonSize;
  /** Extra className for the trigger button. */
  triggerClassName?: string;
  items: DropdownItem[];
  /** Currently selected value (listbox mode — shows check icon on selected). */
  selectedValue?: string;
  /** Called when an item is selected. */
  onSelect?: (value: string) => void;
  /** Menu alignment relative to the trigger. */
  align?: "left" | "right";
  /** Menu width. "trigger" matches trigger width, "auto" fits content, number = px. */
  width?: "trigger" | "auto" | number;
  /** aria-label for the listbox. */
  label?: string;
  /** Hide the check icon on selected items. */
  hideCheck?: boolean;
}

/**
 * Reusable dropdown menu. Renders a Button trigger + listbox menu.
 * Handles outside click, escape key, focus restoration, and a11y.
 *
 * - Pass `triggerLabel` for the visible button text
 * - Pass `items` for the menu options
 * - If `onSelect` is provided with `selectedValue`, it acts as a listbox
 *   (shows check icon on selected item)
 * - Otherwise, it's a menu — items just fire their onClick and the menu closes
 *
 * For complex custom triggers, this component doesn't fit — use a hand-rolled
 * dropdown with the same ARIA pattern.
 */
export default function DropdownMenu({
  triggerLabel,
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
  items,
  selectedValue,
  onSelect,
  align = "left",
  width = "auto",
  label,
  hideCheck = false,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, close]);

  // Width styling
  let widthStyle: React.CSSProperties | undefined;
  let widthClass = "";
  if (width === "trigger") {
    widthClass = "w-full";
  } else if (typeof width === "number") {
    widthStyle = { width: `${width}px` };
  } else {
    widthClass = "min-w-[160px]";
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        ref={triggerRef}
        variant={triggerVariant}
        size={triggerSize}
        className={triggerClassName}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        rightIcon={
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-180")}
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        }
      >
        {triggerLabel}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            style={{ ...widthStyle, transformOrigin: align === "right" ? "top right" : "top left" }}
            className={cn(
              "absolute top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-elevated bg-surface shadow-card",
              widthClass,
              align === "right" ? "right-0" : "left-0",
            )}
          >
            <div className="flex flex-col py-1">
              {items.map((item, i) => {
                const isSelected = selectedValue === item.value;
                const handleClick = () => {
                  if (item.disabled) return;
                  item.onClick?.();
                  onSelect?.(item.value);
                  close();
                };
                return (
                  <motion.button
                    key={item.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={item.disabled}
                    onClick={handleClick}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: i * 0.02,
                      duration: 0.15,
                      ease: "easeOut",
                    }}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left font-mono text-cell transition-colors",
                      "focus-visible:outline-none focus-visible:bg-elevated",
                      item.disabled
                        ? "cursor-not-allowed text-muted/50"
                        : isSelected
                          ? "bg-brand/10 text-brand"
                          : "text-primary hover:bg-elevated",
                    )}
                  >
                    {item.icon && <span className="inline-flex shrink-0">{item.icon}</span>}
                    <span className="flex-1 truncate">{item.label}</span>
                    {!hideCheck && isSelected && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="shrink-0"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
