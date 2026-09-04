"use node";
import { internalAction } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";

export const runLlmTaskRaw = internalAction({
  args: {
    prompt: v.string(),
    systemPrompt: v.optional(v.string()),
    model: v.optional(v.string()),
    temperature: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.runAction(api.llm.runLlmTask, args);
  },
});
