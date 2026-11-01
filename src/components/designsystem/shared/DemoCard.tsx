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
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {/* Header */}
      <div className="flex items-baseline justify-between border-b border-line px-5 py-card-header">
        <h3 className="font-display text-body font-semibold text-primary">{name}</h3>
        <span className="font-mono text-label text-muted">{importPath}</span>
      </div>

      {/* Description */}
      <div className="border-b border-line px-5 py-2">
        <p className="font-body text-cell text-primary">{description}</p>
      </div>

      {/* Preview */}
      <div className="flex min-h-[100px] items-center justify-center border-b border-line p-8">
        {preview}
      </div>

      {/* Controls */}
      {controls && (
        <div className="flex flex-wrap items-end gap-4 border-b border-line bg-elevated/30 px-5 py-card-header">
          {controls}
        </div>
      )}

      {/* Code */}
      <div className="bg-elevated/30 px-5 py-card-header">
        <pre className="overflow-x-auto font-mono text-cell text-primary">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
