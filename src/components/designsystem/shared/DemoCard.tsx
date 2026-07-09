import type { ReactNode } from "react";

export default function DemoCard({
  name,
  importPath,
  description,
  preview,
  controls,
  code,
}: {
  name: string;
  importPath: string;
  description: string;
  preview: ReactNode;
  controls?: ReactNode;
  code: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-elevated bg-surface shadow-card">
      {/* Header */}
      <div className="flex items-baseline justify-between border-b border-elevated px-5 py-card-header">
        <h3 className="font-display text-body font-semibold text-primary">{name}</h3>
        <span className="font-mono text-label text-muted">{importPath}</span>
      </div>

      {/* Description */}
      <div className="border-b border-elevated px-5 py-2">
        <p className="font-body text-cell text-secondary">{description}</p>
      </div>

      {/* Preview */}
      <div className="flex min-h-[100px] items-center justify-center border-b border-elevated p-8">
        {preview}
      </div>

      {/* Controls */}
      {controls && (
        <div className="flex flex-wrap items-end gap-4 border-b border-elevated px-5 py-card-header" style={{ backgroundColor: "color-mix(in srgb, var(--color-elevated) 30%, transparent)" }}>
          {controls}
        </div>
      )}

      {/* Code */}
      <div className="px-5 py-card-header" style={{ backgroundColor: "color-mix(in srgb, var(--color-elevated) 30%, transparent)" }}>
        <pre className="overflow-x-auto font-mono text-cell text-secondary">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
