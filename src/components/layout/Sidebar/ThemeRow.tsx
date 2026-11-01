import { useTheme } from "@/hooks/useTheme";
import PixelIcon from "@/components/shared/PixelIcon";
import { navRowClass } from "./NavLink";

/**
 * Dark mode as a row of the nav, as Toolbox keeps it in its sidebar
 * foot: a switch named by its label. The block in the bar sits right
 * when it's on; CSS places it from the `light` class, so a saved light
 * theme never shows the dark position first.
 */
export function ThemeRow() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      onClick={toggleTheme}
      className={`flex h-9 w-full items-center gap-3 pr-3 font-display text-caps uppercase md:rail:pr-0 ${navRowClass(false)}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">
        <PixelIcon name="moon" />
      </span>
      <span className="whitespace-nowrap md:rail:sr-only">Dark mode</span>
      <span aria-hidden="true" className="ml-auto flex h-3 w-6 border border-current p-px md:rail:hidden">
        <span className="ml-auto size-2 bg-current light:ml-0" />
      </span>
    </button>
  );
}
