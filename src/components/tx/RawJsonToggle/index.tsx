"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

type ViewMode = null | "json" | "receipt";

export default function RawJsonToggle({
  tx,
  meta,
}: {
  tx: Record<string, unknown>;
  meta: Record<string, unknown> | null;
}) {
  const [view, setView] = useState<ViewMode>(null);

  // Transaction receipt = just the meta object
  const receiptData = meta ?? {};
  // Raw JSON = full tx object
  const jsonData = tx;

  return (
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setView(view === "json" ? null : "json")}
          className={`rounded-lg border px-3 py-1.5 font-mono text-tag font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
            view === "json"
              ? "border-brand bg-brand/10 text-brand"
              : "border-elevated bg-surface text-secondary hover:text-primary hover:border-primary/20"
          }`}
        >
          Raw JSON
        </button>
        <button
          type="button"
          onClick={() => setView(view === "receipt" ? null : "receipt")}
          className={`rounded-lg border px-3 py-1.5 font-mono text-tag font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${
            view === "receipt"
              ? "border-brand bg-brand/10 text-brand"
              : "border-elevated bg-surface text-secondary hover:text-primary hover:border-primary/20"
          }`}
        >
          Transaction receipt
        </button>
      </div>
      <AnimatePresence>
        {view && (
          <motion.pre
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="mt-3 max-h-[600px] overflow-auto rounded-2xl border border-elevated bg-surface p-4 font-mono text-cell text-secondary"
          >
            {JSON.stringify(
              view === "json" ? jsonData : receiptData,
              null,
              2,
            )}
          </motion.pre>
        )}
      </AnimatePresence>
    </div>
  );
}
