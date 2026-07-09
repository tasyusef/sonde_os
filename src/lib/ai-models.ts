/**
 * Central model config for all AI features.
 *
 * Single source of truth for model IDs, pricing, and defaults. All AI call
 * sites (intel query router, investigation, portfolio query) read from here.
 *
 * To swap models: change the value in `DEFAULT_MODELS`. That's it.
 * To add a new provider or model: add an entry to `MODEL_PRICING` and
 * optionally update `DEFAULT_MODELS`.
 *
 * Designed so a future BYOK model picker is a zero-refactor addition —
 * call sites already accept an optional `model` override.
 */

import "server-only";

export type AiProvider = "anthropic" | "google" | "openai";

/**
 * Per-million token pricing in USD.
 * Update when providers revise prices. Unknown models cost 0 (never
 * throws — usage tracking should never break request flow).
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 15, output: 75 },

  // Google
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },

  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
};

/**
 * Default model per provider. Used when no explicit model is passed.
 *
 * Anthropic: bumped from Haiku 4.5 → Sonnet 4.6 on 2026-05-03. Haiku
 * was undersized for /asktheledger SQL routing — it would sum raw
 * token amounts (mixed-precision per-issuer) instead of the
 * XRP-equivalent volume column, producing answers like "5.29 × 10¹⁸"
 * that aren't comparable across tokens. Sonnet handles the schema
 * reasoning materially better. Cost per Pro user (50 queries/mo cap)
 * goes from ~$0.50/mo to ~$1.50/mo — healthy margin retained at the
 * $5/mo Pro tier.
 */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  google: "gemini-2.0-flash",
  openai: "gpt-4o",
};

/** Returns the default model ID for a provider. */
export function getDefaultModel(provider: AiProvider): string {
  return DEFAULT_MODELS[provider];
}

/**
 * Calculate cost in USD from token counts. Returns 0 for unknown models
 * rather than throwing so usage tracking never breaks request flow.
 */
export function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICING[model];
  if (!p) return 0;
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
}
