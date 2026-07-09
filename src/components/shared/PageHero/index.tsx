import { type ReactNode } from "react";
import DataWindowBadge from "@/components/shared/DataWindowBadge";

/** Shared gradient + grid backdrop used in all page hero sections. */
export function HeroBackground() {
  return (
    <>
      <div className="dashboard-gradient pointer-events-none absolute -left-4 -right-4 -top-6 bottom-0 md:-right-6" />
      <div className="landing-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_80%_70%_at_50%_30%,black_30%,transparent_100%)]" />
    </>
  );
}

interface PageHeroProps {
  title: string;
  accent?: string;
  subtitle: string;
  /** When true, renders the "~11mo data window" pill inline with the
   *  subtitle. Opt-in so non-data pages (about, support, designsystem)
   *  don't surface it. */
  showDataWindow?: boolean;
  children?: ReactNode;
}

export default function PageHero({
  title,
  accent,
  subtitle,
  showDataWindow,
  children,
}: PageHeroProps) {
  return (
    <section className="relative">
      {/* Gradient extends behind topbar on mobile + sidebar on desktop */}
      <div className="pointer-events-none absolute inset-0 -top-18 overflow-hidden md:top-0 md:-left-18">
        <HeroBackground />
      </div>

      <div className="relative mx-auto max-w-container px-6 pt-6 pb-3 sm:pt-8 sm:pb-4">
        <h1 className="font-display text-heading font-bold leading-[1.1] tracking-[-0.5px] text-primary sm:text-title">
          {title}
          {accent && (
            <>
              {" "}
              <span className="text-brand">{accent}</span>
            </>
          )}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="font-body text-body text-secondary">{subtitle}</p>
          {showDataWindow && <DataWindowBadge />}
        </div>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </section>
  );
}
