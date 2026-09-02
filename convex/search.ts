"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { env } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import OpenAI from "openai";

export const searchDocuments = action({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const docs: Doc<"documents">[] = await ctx.runQuery(api.documents.listDocuments);

    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY!,
      baseURL: "https://integrate.api.nvidia.com/v1",
    });
    const response = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: args.query,
    });
    const queryEmbedding = response.data[0].embedding;

    const scored: { doc: Doc<"documents">; score: number }[] = docs.map((doc) => {
      const docEmbedding = doc.embedding;
      if (!docEmbedding) return { doc, score: 0 };
      let dotProduct = 0;
      let queryMag = 0;
      let docMag = 0;
      for (let i = 0; i < queryEmbedding.length; i++) {
        dotProduct += queryEmbedding[i] * docEmbedding[i];
        queryMag += queryEmbedding[i] * queryEmbedding[i];
        docMag += docEmbedding[i] * docEmbedding[i];
      }
      const score = dotProduct / (Math.sqrt(queryMag) * Math.sqrt(docMag) || 1);
      return { doc, score };
    });

    return scored
      .filter((s) => s.score > 0.5)
      .sort((a, b) => b.score - a.score)
      .map((s) => ({
        source: s.doc.source,
        content: s.doc.content,
        score: s.score,
      }));
  },
});
