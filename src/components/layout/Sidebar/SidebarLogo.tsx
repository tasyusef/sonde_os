import { Link } from "react-router";
import { SondeMark, SondeWordmark } from "@/components/shared/SondeLogo";

/** The logo as the sidebar and the mobile bar set it: the mark in a
 *  36px box, so it centres over the nav's marks and the wordmark over
 *  their labels (the odd 21px mark lands on a half pixel, which
 *  browsers snap). The collapsed rail keeps the mark. */
export function SidebarLogo() {
  return (
    // Logo-only link: the name comes from `aria-label`, the SVGs are
    // hidden (SondeMark/SondeWordmark don't forward ARIA props, hence
    // the wrapper span).
    <Link to="/" aria-label="Sonde home" className="flex">
      <span aria-hidden="true" className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center">
          <SondeMark className="text-brand" />
        </span>
        <SondeWordmark className="shrink-0 text-primary md:rail:hidden" />
      </span>
    </Link>
  );
}
