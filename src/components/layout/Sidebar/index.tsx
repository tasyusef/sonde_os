import { useLocation } from "react-router";
import PixelIcon from "@/components/shared/PixelIcon";
import { toggleSidebar } from "@/lib/sidebar";
import { navRowClass } from "./NavLink";
import { MobileHeader } from "./MobileHeader";
import { SidebarBody } from "./SidebarBody";
import { SidebarLogo } from "./SidebarLogo";

/**
 * Desktop sidebar, docked beside the page as Toolbox's is: the logo on
 * the page ground, level with the status strip, then the nav on the
 * dither mat with no rules. The logo sits as far from the top as from
 * the left. Collapse narrows it to a rail of marks. The state is the
 * `sidebar-rail` class on <html> (`lib/sidebar`), so the `rail:`
 * variant draws both widths and a saved rail is right on first paint.
 * The width eases between them; labels swap at once and the column
 * clips them while it moves. On mobile the same mat opens from the
 * header's menu.
 */
export default function Sidebar() {
  const { pathname } = useLocation();

  return (
    <>
      <aside
        aria-label="Sidebar"
        className="sticky top-0 hidden h-dvh w-58 shrink-0 flex-col overflow-hidden transition-[width] duration-300 ease-in-out motion-reduce:transition-none md:flex md:rail:w-14"
      >
        {/* 10px lines the mark up over the nav's marks. The rail is the 36px
             mark box and that padding, so neither width moves a mark. */}
        <div className="flex h-14 shrink-0 items-center px-2.5">
          <SidebarLogo />
        </div>

        <SidebarBody
          pathname={pathname}
          foot={
            <button
              type="button"
              onClick={toggleSidebar}
              className={`flex h-9 w-full items-center gap-3 pr-3 font-display text-caps uppercase md:rail:pr-0 ${navRowClass(false)}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                <PixelIcon name="arrow-left" className="md:rail:hidden" />
                <PixelIcon name="arrow" className="hidden md:rail:block" />
              </span>
              <span className="whitespace-nowrap md:rail:hidden">
                Collapse<span className="sr-only"> sidebar</span>
              </span>
              <span className="sr-only hidden md:rail:inline">Expand sidebar</span>
            </button>
          }
        />
      </aside>

      {/* Keyed on the path, so a navigation closes the menu. */}
      <MobileHeader key={pathname} pathname={pathname} />
    </>
  );
}
