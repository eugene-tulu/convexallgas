"use node";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { env } from "./_generated/server";
import { api } from "./_generated/api";
import { internal } from "./_generated/api";
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

    const docContext = docs
      .map((d, i) => `[${i}] Source: ${d.source}\nContent: ${d.content.slice(0, 500)}`)
      .join("\n\n");

    const prompt = `You are a compliance document search assistant. Given a user query and a set of documents, return the indices of the most relevant documents (max 5) as a JSON array of numbers.

User query: ${args.query}

Documents:
${docContext}

Return ONLY a JSON array of indices, e.g. [0, 3, 1]. If no documents are relevant, return [].`;

    const response = await openai.chat.completions.create({
      model: "nvidia/llama-3.1-405b-instruct",
      temperature: 0.1,
      messages: [
        { role: "system", content: "You return only valid JSON arrays of numbers." },
        { role: "user", content: prompt },
      ],
    });

    const content = response.choices[0].message.content ?? "[]";
    const match = content.match(/\[[\d,\s]*\]/);
    const indices: number[] = match ? JSON.parse(match[0]) : [];

    return indices
      .filter((i) => i >= 0 && i < docs.length)
      .map((i) => ({
        source: docs[i].source,
        content: docs[i].content,
        score: 1 - indices.indexOf(i) * 0.1,
      }));
  },
});

export const searchRegulations = action({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const regulations: Doc<"regulations">[] = await ctx.runQuery(api.regulations.list);

    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY!,
      baseURL: "https://integrate.api.nvidia.com/v1",
    });

    const regContext = regulations
      .map((r, i) => `[${i}] Agency: ${r.agency}\nSummary: ${r.summary}\nURL: ${r.sourceUrl}`)
      .join("\n\n");

    const prompt = `You are a regulatory search assistant. Given a user query and a set of regulations, return the indices of the most relevant regulations (max 5) as a JSON array of numbers.

User query: ${args.query}

Regulations:
${regContext}

Return ONLY a JSON array of numbers, e.g. [0, 3, 1]. If no regulations are relevant, return [].`;

    const response = await openai.chat.completions.create({
      model: "nvidia/llama-3.1-405b-instruct",
      temperature: 0.1,
      messages: [
        { role: "system", content: "You return only valid JSON arrays of numbers." },
        { role: "user", content: prompt },
      ],
    });

    const content = response.choices[0].message.content ?? "[]";
    const match = content.match(/\[[\d,\s]*\]/);
    const indices: number[] = match ? JSON.parse(match[0]) : [];

    return indices
      .filter((i) => i >= 0 && i < regulations.length)
      .map((i) => ({
        agency: regulations[i].agency,
        summary: regulations[i].summary,
        sourceUrl: regulations[i].sourceUrl,
        crawledAt: regulations[i].crawledAt,
        score: 1 - indices.indexOf(i) * 0.1,
      }));
  },
});

export const generateEmbedding = internalAction({
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY!,
      baseURL: "https://integrate.api.nvidia.com/v1",
    });
    try {
      const response = await openai.embeddings.create({
        model: "nvidia/nv-embedqa-e5-v5",
        input: args.text,
      });
      return response.data[0].embedding;
    } catch (e) {
      return [];
    }
  },
});
