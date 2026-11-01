import SectionHeader from "./SectionHeader";

export default function ShadowSection() {
  return (
    <section id="shadows" className="scroll-mt-20">
      <SectionHeader
        title="Shadows"
        subtitle="Two elevation levels with automatic light/dark mode variants."
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <div className="flex h-40 cursor-pointer items-center justify-center rounded-2xl bg-surface shadow-card hover:shadow-card-hover">
            <span className="font-mono text-cell text-muted">
              Hover me
            </span>
          </div>
          <div>
            <p className="font-mono text-cell font-medium text-primary">shadow-card</p>
            <p className="font-mono text-label text-muted">
              Default card elevation. Transitions to shadow-card-hover on hover.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex h-40 items-center justify-center rounded-2xl bg-surface shadow-card-hover">
            <span className="font-mono text-cell text-muted">shadow-card-hover</span>
          </div>
          <div>
            <p className="font-mono text-cell font-medium text-primary">
              shadow-card-hover
            </p>
            <p className="font-mono text-label text-muted">
              Elevated state for focused or hovered cards.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
