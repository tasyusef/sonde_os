/**
 * Multi-provider AI abstraction for the intelligence layer.
 *
 * Supports Anthropic, Google (Gemini), and OpenAI using user-supplied keys.
 * Keys are passed per-request from the client — never stored server-side.
 */

import "server-only";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { getDefaultModel, type AiProvider } from "./ai-models";

/**
 * Tool-call shape returned by Google / OpenAI providers (Anthropic uses
 * native tool calls). The model is prompted to emit
 * {"tool": string, "input": object}; anything else is treated as
 * regular text.
 */
const ToolCallEnvelopeSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.unknown()).optional(),
});

export type { AiProvider };

interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiCompletionOptions {
  provider: AiProvider;
  apiKey: string;
  system: string;
  messages: AiMessage[];
  maxTokens?: number;
  /** Optional explicit model override. Falls back to DEFAULT_MODELS[provider]. */
  model?: string;
  /**
   * Anthropic-only: prefill the assistant response. Useful to force
   * structured output (e.g. prefill "{" to guarantee JSON-only output).
   * The returned `text` includes the prefill, so callers can parse as normal.
   * Ignored for Google/OpenAI — those rely on the caller's own cleanup.
   */
  prefill?: string;
}

export interface AiToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AiToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

interface AiCompletionResponse {
  text: string;
  usage: AiUsage;
  /** The model ID actually used for this request. Surfaced so callers can log it. */
  model: string;
}

/** Single event yielded by createCompletionStream. */
export type StreamDelta =
  | { type: "text"; text: string }
  | { type: "usage"; usage: AiUsage; model: string };

/** Provider-specific streaming support. Anthropic is supported today;
 *  Google + OpenAI throw and the caller should fall back to non-streaming. */
export const STREAMING_PROVIDERS: ReadonlySet<AiProvider> = new Set(["anthropic"]);

export function supportsStreaming(provider: AiProvider): boolean {
  return STREAMING_PROVIDERS.has(provider);
}

interface AiCompletionResult {
  text: string;
  toolCalls: AiToolCall[];
  stopReason: string;
  usage: AiUsage;
  /** The model ID actually used for this request. Surfaced so callers can log it. */
  model: string;
}

interface AiToolCompletionOptions extends AiCompletionOptions {
  tools: AiToolDef[];
  toolResults?: Array<{ id: string; content: string }>;
}

/**
 * Run a simple text completion (no tools).
 */
export async function createCompletion(options: AiCompletionOptions): Promise<AiCompletionResponse> {
  const { provider, apiKey, system, messages, maxTokens = 2048 } = options;
  const model = options.model ?? getDefaultModel(provider);

  switch (provider) {
    case "anthropic": {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });
      const msgs: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));
      if (options.prefill) {
        msgs.push({ role: "assistant", content: options.prefill });
      }
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages: msgs,
      });
      const text = response.content.find((b) => b.type === "text");
      const raw = text?.text ?? "";
      return {
        text: options.prefill ? options.prefill + raw : raw,
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
        model,
      };
    }

    case "google": {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      const googleModel = genAI.getGenerativeModel({
        model,
        systemInstruction: system,
      });
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" as const : "user" as const,
        parts: [{ text: m.content }],
      }));
      const result = await googleModel.generateContent({
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
      });
      const meta = result.response.usageMetadata;
      return {
        text: result.response.text(),
        usage: {
          inputTokens: meta?.promptTokenCount ?? 0,
          outputTokens: meta?.candidatesTokenCount ?? 0,
        },
        model,
      };
    }

    case "openai": {
      const OpenAI = (await import("openai")).default;
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        ],
      });
      return {
        text: response.choices[0]?.message?.content ?? "",
        usage: {
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
        model,
      };
    }

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Streaming variant of createCompletion. Yields token deltas as they
 * arrive from the upstream provider, plus a final usage event with the
 * cumulative token counts + model ID once the stream closes.
 *
 * v1 supports Anthropic only — Google and OpenAI throw a marker error
 * (the route handler is expected to check supportsStreaming() before
 * calling this and fall back to non-streaming for unsupported providers).
 */
export async function* createCompletionStream(
  options: AiCompletionOptions,
): AsyncIterable<StreamDelta> {
  const { provider, apiKey, system, messages, maxTokens = 2048 } = options;
  const model = options.model ?? getDefaultModel(provider);

  if (provider !== "anthropic") {
    throw new Error(`Streaming not yet supported for provider: ${provider}`);
  }

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });
  const msgs: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (options.prefill) {
    msgs.push({ role: "assistant", content: options.prefill });
  }

  // If a prefill was supplied, emit it up front so the caller's
  // accumulated text matches the non-streaming path's `text` field.
  if (options.prefill) {
    yield { type: "text", text: options.prefill };
  }

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system,
    messages: msgs,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "text", text: event.delta.text };
    }
  }

  // Finalize — the SDK aggregates usage on the final message.
  const finalMessage = await stream.finalMessage();
  yield {
    type: "usage",
    usage: {
      inputTokens: finalMessage.usage?.input_tokens ?? 0,
      outputTokens: finalMessage.usage?.output_tokens ?? 0,
    },
    model,
  };
}

/**
 * Run a completion with tool calling support.
 * Only Anthropic supports the full tool-calling loop natively.
 * Google and OpenAI use a simplified approach.
 */
export async function createToolCompletion(
  options: AiToolCompletionOptions,
): Promise<AiCompletionResult> {
  const { provider, apiKey, system, messages, tools, maxTokens = 4096 } = options;
  const model = options.model ?? getDefaultModel(provider);

  switch (provider) {
    case "anthropic": {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const client = new Anthropic({ apiKey });

      const anthropicTools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool["input_schema"],
      }));

      // Build messages including any tool results
      const msgs: Anthropic.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      if (options.toolResults) {
        // Last assistant message had tool calls — append tool results
        const toolResultBlocks: Anthropic.ToolResultBlockParam[] = options.toolResults.map((tr) => ({
          type: "tool_result" as const,
          tool_use_id: tr.id,
          content: tr.content,
        }));
        msgs.push({ role: "user", content: toolResultBlocks });
      }

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: anthropicTools,
        messages: msgs,
      });

      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text",
      );
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      return {
        text: textBlocks.map((b) => b.text).join("\n\n"),
        toolCalls: toolUseBlocks.map((b) => ({
          id: b.id,
          name: b.name,
          input: b.input as Record<string, unknown>,
        })),
        stopReason: response.stop_reason ?? "end_turn",
        usage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
        model,
      };
    }

    case "google":
    case "openai": {
      // For non-Anthropic providers, use a simplified approach:
      // Include tool descriptions in the system prompt and ask the LLM
      // to respond with JSON when it wants to use a tool.
      const toolDesc = tools
        .map((t) => `Tool: ${t.name}\nDescription: ${t.description}\nInput: ${JSON.stringify(t.input_schema)}`)
        .join("\n\n");

      const enhancedSystem = `${system}\n\nYou have access to these tools. To use a tool, respond with ONLY a JSON object: {"tool": "tool_name", "input": {...}}. Otherwise respond normally.\n\n${toolDesc}`;

      const completion = await createCompletion({
        provider,
        apiKey,
        system: enhancedSystem,
        messages,
        maxTokens,
        model,
      });

      // Try to parse as tool call (handle bare JSON and markdown-fenced JSON)
      const jsonMatch = completion.text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/) ?? [null, completion.text.trim()];
      const candidate = jsonMatch[1]?.trim() ?? "";
      try {
        const parsed: unknown = JSON.parse(candidate);
        const envelope = ToolCallEnvelopeSchema.safeParse(parsed);
        if (envelope.success) {
          return {
            text: "",
            toolCalls: [{
              id: crypto.randomUUID(),
              name: envelope.data.tool,
              input: envelope.data.input ?? {},
            }],
            stopReason: "tool_use",
            usage: completion.usage,
            model: completion.model,
          };
        }
      } catch {
        // Not JSON — it's a regular text response
      }

      return {
        text: completion.text,
        toolCalls: [],
        stopReason: "end_turn",
        usage: completion.usage,
        model: completion.model,
      };
    }

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
