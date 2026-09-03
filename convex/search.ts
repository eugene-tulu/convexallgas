"use node";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { rag, nvidiaChat } from "./rag";
import type { EntryId } from "@convex-dev/rag";

export const addDocument = action({
  args: {
    title: v.string(),
    content: v.string(),
    url: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    importance: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const namespace = args.projectId ?? "global";
    const { entryId, status, created } = await rag.add(ctx, {
      namespace: `project-${namespace}`,
      key: args.url ?? args.title,
      text: `${args.title}\n\n${args.content}`,
      title: args.title,
      importance: args.importance ?? 0.5,
    });
    return { entryId: entryId as string, status, created };
  },
});

export const addRegulation = action({
  args: {
    sourceUrl: v.string(),
    title: v.string(),
    content: v.string(),
    summary: v.optional(v.string()),
    agency: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const namespace = args.projectId ?? "global";
    const text = `${args.title}\n\nAgency: ${args.agency ?? "Unknown"}\n\n${args.summary ?? ""}\n\n${args.content}`;
    const { entryId, status, created } = await rag.add(ctx, {
      namespace: `project-${namespace}`,
      key: args.sourceUrl,
      text,
      title: args.title,
      importance: 0.7,
    });
    return { entryId: entryId as string, status, created };
  },
});

export const searchDocuments = action({
  args: {
    query: v.string(),
    projectId: v.optional(v.id("projects")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const namespace = args.projectId ? `project-${args.projectId}` : "global";
    const { results, text, entries } = await rag.search(ctx, {
      namespace,
      query: args.query,
      limit: args.limit ?? 10,
      vectorScoreThreshold: 0.3,
    });

    return {
      context: text,
      results: results.map((r) => ({
        entryId: r.entryId as unknown as string,
        score: r.score,
        content: r.content.map((c) => c.text).join("\n"),
      })),
      entries: entries.map((e) => ({
        entryId: e.entryId as unknown as string,
        title: e.title,
        importance: e.importance,
      })),
    };
  },
});

export const askDocuments = action({
  args: {
    question: v.string(),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const namespace = args.projectId ? `project-${args.projectId}` : "global";
    const { text, context } = await rag.generateText(ctx, {
      search: { namespace, limit: 5, vectorScoreThreshold: 0.3 },
      prompt: args.question,
      model: nvidiaChat,
    });
    return { answer: text, context };
  },
});

export const deleteDocument = internalAction({
  args: { entryId: v.string() },
  handler: async (ctx, args) => {
    await rag.delete(ctx, { entryId: args.entryId as EntryId });
    return { success: true };
  },
});

export const seedRagDemo = action({
  args: {},
  handler: async (ctx) => {
    const docs = [
      {
        title: "Merced Solar — Post-Construction Monitoring Report, 2022",
        content:
          "Mitigation measure: Bat acoustic deterrent deployment at Merced Solar site, 2022. " +
          "The deterrent reduced bat fatalities by 67% compared to pre-installation baseline. " +
          "Operational from March to November, active during peak migration periods. " +
          "Recommendation: Extend deployment duration for 2023 monitoring cycle.",
        importance: 0.8,
      },
      {
        title: "CDFW Comments on Draft EIA, February 2021",
        content:
          "Agency response: California Department of Fish and Wildlife noted that the " +
          "bat monitoring protocol should be expanded to include summer maternity roost " +
          "sites. The Department recommended a revised statistical model for fatality " +
          "estimation that accounts for carcass displacement under operational turbines.",
        importance: 0.7,
      },
      {
        title: "Noise Monitoring Protocol for Wind Facilities, 2020",
        content:
          "Standard protocol for measuring turbine noise at wind facilities in California. " +
          "Measurements taken at 70m from turbine base during operation. Sound pressure " +
          "levels averaged over 10-minute intervals. Compliance threshold: 45 dBA at " +
          "project boundary during nighttime hours.",
        importance: 0.6,
      },
    ];

    const results = [];
    for (const doc of docs) {
      const r = await rag.add(ctx, {
        namespace: "global",
        key: doc.title,
        text: `${doc.title}\n\n${doc.content}`,
        title: doc.title,
        importance: doc.importance,
      });
      results.push({ entryId: r.entryId as unknown as string, status: r.status });
    }
    return results;
  },
});
