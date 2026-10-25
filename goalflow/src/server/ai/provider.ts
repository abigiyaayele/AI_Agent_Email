import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env, features } from "@/lib/env";

export type GenerateRequest<T extends z.ZodType> = {
  system: string;
  prompt: string;
  schema: T;
  maxTokens?: number;
};

/** Swap-able AI backend. Only server code calls it; keys never reach the browser. */
export interface AiProvider {
  readonly name: string;
  generate<T extends z.ZodType>(req: GenerateRequest<T>): Promise<z.infer<T>>;
}

export class AiUnavailableError extends Error {}

class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  }

  async generate<T extends z.ZodType>(req: GenerateRequest<T>): Promise<z.infer<T>> {
    const res = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      output_config: { effort: "medium", format: betaZodOutputFormat(req.schema) },
      // Server-side fallback: if the primary model declines, the API retries on a suitable model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") throw new AiUnavailableError("The AI declined this request.");
    if (res.stop_reason === "max_tokens") throw new AiUnavailableError("The AI response was cut off.");
    if (!res.parsed_output) throw new AiUnavailableError("The AI returned an unreadable response.");
    return res.parsed_output as z.infer<T>;
  }
}

let cached: AiProvider | null | undefined;

/** Returns null when AI is not configured; callers then use the built-in rule-based logic. */
export function aiProvider(): AiProvider | null {
  if (cached !== undefined) return cached;
  const e = env();
  cached = features().ai ? new AnthropicProvider(e.ANTHROPIC_API_KEY!, e.AI_MODEL || "claude-opus-5-5") : null;
  return cached;
}

/** For tests: inject a fake provider. */
export function setAiProviderForTesting(p: AiProvider | null) {
  cached = p;
}
