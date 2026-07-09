"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import ResponsiveSelect from "@/components/shared/ResponsiveSelect";
import Button from "@/components/shared/Button";
import type { AiProvider } from "@/components/intel/IntelligenceContext";

const AI_PROVIDER_KEY = "sonde_intel_ai_provider";
const aiKeyStorageKey = (provider: string) => `sonde_intel_ai_key_${provider}`;

const PROVIDERS: { id: AiProvider; label: string; placeholder: string }[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-..." },
  { id: "google", label: "Google", placeholder: "AIza..." },
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
];

export default function AiSection() {
  const [expanded, setExpanded] = useState(false);
  const [provider, setProviderState] = useState<AiProvider>(() => {
    if (typeof window === "undefined") return "anthropic";
    return (localStorage.getItem(AI_PROVIDER_KEY) as AiProvider) ?? "anthropic";
  });
  const [hasKey, setHasKey] = useState(() => {
    if (typeof window === "undefined") return false;
    const p = (localStorage.getItem(AI_PROVIDER_KEY) as AiProvider) ?? "anthropic";
    return !!sessionStorage.getItem(aiKeyStorageKey(p));
  });
  const [keyInput, setKeyInput] = useState("");

  const currentProvider = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  const handleProviderChange = (p: AiProvider) => {
    setProviderState(p);
    try { localStorage.setItem(AI_PROVIDER_KEY, p); } catch { /* ignore */ }
    setHasKey(!!sessionStorage.getItem(aiKeyStorageKey(p)));
  };

  const handleSaveKey = () => {
    if (!keyInput.trim()) return;
    try { sessionStorage.setItem(aiKeyStorageKey(provider), keyInput.trim()); } catch { /* ignore */ }
    setHasKey(true);
    setKeyInput("");
  };

  const handleClearKey = () => {
    try { sessionStorage.removeItem(aiKeyStorageKey(provider)); } catch { /* ignore */ }
    setHasKey(false);
  };

  return (
    <div>
      {/* Summary row — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between rounded-lg border border-elevated bg-surface px-3 py-2 transition-colors hover:border-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
      >
        <span className="font-mono text-label text-muted">AI Key</span>
        <span className="flex items-center gap-1.5">
          {hasKey ? (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              <span className="font-mono text-tag font-medium text-success">{currentProvider.label}</span>
            </span>
          ) : (
            <span className="font-mono text-tag text-muted">Not set</span>
          )}
          <svg
            className={cn("h-3 w-3 text-muted transition-transform duration-200", expanded && "rotate-180")}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
      </button>

      {/* Expanded panel */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1.5 space-y-2 rounded-lg border border-elevated bg-surface p-2">
              <ResponsiveSelect
                options={PROVIDERS.map((p) => ({ value: p.id, label: p.label }))}
                active={provider}
                onChange={handleProviderChange}
                ariaLabel="AI provider"
              />

              {hasKey ? (
                <div className="flex items-center gap-1.5">
                  <span className="flex-1 font-mono text-label text-muted">Key active</span>
                  <button
                    onClick={() => { handleClearKey(); setKeyInput(""); }}
                    className="font-mono text-label text-muted hover:text-error transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveKey()}
                    placeholder={currentProvider.placeholder}
                    className="flex-1 rounded-lg border border-elevated bg-surface px-2.5 py-1 font-mono text-cell text-primary placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                    aria-label={`${currentProvider.label} API key`}
                  />
                  <Button onClick={handleSaveKey} disabled={!keyInput.trim()} variant="primary" size="sm">Save</Button>
                </div>
              )}

              <p className="font-mono text-micro leading-tight text-muted/40">
                Session only. Not stored on our servers.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
