"use node";
import { internalAction } from "./_generated/server";
import { env } from "./_generated/server";
import { v } from "convex/values";
import OpenAI from "openai";

const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

function getClient() {
  return new OpenAI({
    apiKey: env.OPENAI_API_KEY!,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });
}

export function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {}

  let cleaned = text.replace(/```(?:json)?\n?/gi, "").replace(/```\n?/g, "");

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {}
      }
    }
  }

  return null;
}

export const runLlmTask = internalAction({
  args: {
    prompt: v.string(),
    systemPrompt: v.optional(v.string()),
    model: v.optional(v.string()),
    temperature: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (args.prompt.length > 20000)
      throw new Error("LLM prompt is too large");
    const client = getClient();
    const response = await client.chat.completions.create({
      model: args.model ?? DEFAULT_MODEL,
      temperature: args.temperature ?? 0.7,
      messages: [
        ...(args.systemPrompt
          ? [{ role: "system" as const, content: args.systemPrompt }]
          : []),
        { role: "user" as const, content: args.prompt },
      ],
    });
    return response.choices[0].message.content ?? "";
  },
});
