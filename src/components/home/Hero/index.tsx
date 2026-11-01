import { useRef } from "react";
import Globe from "@/components/home/Globe";
import UnifiedSearch from "@/components/layout/Search/UnifiedSearch";

/**
 * The landing page: the turning globe and the search across its middle,
 * and nothing else. The hero fills the screen below the status strip on
 * desktop; below `md` it runs under the header to the top edge, and the
 * globe keeps to the room below the header.
 */
export default function Hero() {
  const searchRef = useRef<HTMLDivElement>(null);

  return (
    <section
      aria-labelledby="hero-title"
      className="relative -mt-[var(--topbar-h-mobile)] flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 pt-[var(--topbar-h-mobile)] md:mt-0 md:min-h-[calc(100svh-3.5rem)] md:pt-0"
    >
      <Globe
        clearRef={searchRef}
        className="absolute inset-x-0 top-[var(--topbar-h-mobile)] bottom-0 md:top-0"
      />
      <h1 id="hero-title" className="sr-only">
        Sonde, the XRPL explorer
      </h1>
      <div ref={searchRef} className="relative w-full max-w-xl">
        <UnifiedSearch variant="hero" />
      </div>
    </section>
  );
}
