import { cn } from "@/lib/utils";
import type { ListboxOptionProps } from "./useListboxKeys";
import PixelIcon from "@/components/shared/PixelIcon";

/** One row of CustomSelect's listbox. `listboxProps` (ref, tabIndex,
 *  arrow-key handling) comes from `useListboxKeys().getOptionProps`. */
export default function SelectOption({
  label,
  selected,
  listboxProps,
  onSelect,
}: {
  label: string;
  selected: boolean;
  listboxProps: ListboxOptionProps;
  onSelect: () => void;
}) {
  return (
    // The global focus outline is inset: the panel clips.
    <button
      {...listboxProps}
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left font-display text-caps uppercase",
        "-outline-offset-2",
        selected
          ? "bg-accent text-on-accent"
          : "text-primary hover:bg-primary hover:text-black focus-visible:bg-primary focus-visible:text-black",
      )}
    >
      <span>{label}</span>
      {selected && (
        <PixelIcon name="check" size="sm" className="shrink-0" />
      )}
    </button>
  );
}
