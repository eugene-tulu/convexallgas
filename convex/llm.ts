"use node";
import { action } from "./_generated/server";
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

export const runLlmTask = action({
  args: {
    prompt: v.string(),
    systemPrompt: v.optional(v.string()),
    model: v.optional(v.string()),
    temperature: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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
