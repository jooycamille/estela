import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

let client: Anthropic | null = null;

/** Claude features are optional: without credentials the app uses its rule-based fallbacks. */
export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function getClient() {
  client ??= new Anthropic();
  return client;
}

/** The shared Claude client, for features that call it directly (like the chat). */
export const claude = () => getClient();

/**
 * One structured-output call. Returns null when Claude declines or the output
 * doesn't parse, so callers can fall back to the heuristic path.
 */
export async function extract<T extends z.ZodType>(
  schema: T,
  system: string,
  prompt: string,
  effort: "low" | "medium" | "high" = "low",
): Promise<z.infer<T> | null> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort, format: betaZodOutputFormat(schema) },
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  return (response.parsed_output as z.infer<T> | null) ?? null;
}
