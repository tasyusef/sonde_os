import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import Button, { type ButtonVariant, type ButtonSize } from "@/components/shared/Button";
import { slideDownVariants, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import PixelIcon from "@/components/shared/PixelIcon";

/** Seconds between items as the menu opens. */
const ITEM_STAGGER = 0.02;

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
          <PixelIcon name={open ? "chevron-up" : "chevron-down"} size="sm" />
        }
      >
        {triggerLabel}
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={label}
            variants={slideDownVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={SPRING.pop}
            style={{ ...widthStyle, transformOrigin: align === "right" ? "top right" : "top left" }}
            className={cn(
              "absolute top-full z-50 mt-1.5 overflow-hidden bg-surface shadow-card",
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
                    transition={{ ...SPRING.smooth, delay: i * ITEM_STAGGER }}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left font-mono text-cell",
                      "-outline-offset-2",
                      item.disabled
                        ? "cursor-not-allowed text-muted/50"
                        : isSelected
                          ? "bg-accent text-on-accent"
                          : "text-primary hover:bg-primary hover:text-black focus-visible:bg-primary focus-visible:text-black",
                    )}
                  >
                    {item.icon && <span className="inline-flex shrink-0">{item.icon}</span>}
                    <span className="flex-1 truncate">{item.label}</span>
                    {!hideCheck && isSelected && (
                      <PixelIcon name="check" size="sm" className="shrink-0" />
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
