"use node";
import { action } from "./_generated/server";
import { env } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Firecrawl } from "firecrawl";

function getClient() {
  return new Firecrawl({ apiKey: env.FIRECRAWL_API_KEY! });
}

export const scrape = action({
  args: {
    url: v.string(),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.scrape(args.url, {
      formats: ["markdown", "summary"],
    });
    return {
      url: args.url,
      markdown: result.markdown ?? "",
      title: result.metadata?.title ?? "",
      html: result.html ?? "",
      summary: result.summary ?? "",
    };
  },
});

export const search = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.search(args.query, {
      limit: args.limit ?? 10,
    });
    const webResults = result.web ?? [];
    return webResults
      .filter((r): r is { title?: string; url: string; description?: string } => "url" in r)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        description: r.description ?? "",
      }));
  },
});

export const crawl = action({
  args: {
    url: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.crawl(args.url, {
      limit: args.limit ?? 50,
      scrapeOptions: {
        formats: ["markdown", "summary"],
      },
    });
    return result.data.map((page) => ({
      url: page.metadata?.sourceURL ?? "",
      markdown: page.markdown ?? "",
      title: page.metadata?.title ?? "",
      summary: page.summary ?? "",
    }));
  },
});

export const map = action({
  args: {
    url: v.string(),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.map(args.url, {
      search: args.search,
      limit: args.limit ?? 50,
    });
    return result.links ?? [];
  },
});

export const research = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const client = getClient();
    const result = await client.research.searchPapers(args.query, {
      k: args.limit ?? 10,
    });
    return result.results.map((paper) => ({
      title: paper.title,
      abstract: paper.abstract,
      score: paper.score,
      paperId: paper.paperId,
    }));
  },
});

export const crawlSource = scrape;

export const searchAndPersist = action({
  args: {
    query: v.string(),
    projectId: v.optional(v.id("projects")),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ inserted: number; ids: string[]; results: Array<{ title: string; url: string; description: string }> }> => {
    const client = getClient();
    const result = await client.search(args.query, {
      limit: args.limit ?? 10,
    });
    const webResults = result.web ?? [];
    const filtered = webResults.filter(
      (r): r is { title?: string; url: string; description?: string; category?: string } => "url" in r
    );

    const now = Date.now();
    const ids: string[] = [];
    for (const r of filtered) {
      const id: string = await ctx.runMutation(internal.regulations.insertRegulation, {
        sourceUrl: r.url,
        agency: r.category ?? "Unknown",
        extractedText: r.description ?? "",
        summary: r.title ?? "",
        affectedProjectIds: args.projectId ? [args.projectId] : [],
        crawledAt: now,
        isNew: true,
      });
      ids.push(id);
    }

    return {
      inserted: ids.length,
      ids,
      results: filtered.map((r) => ({
        title: r.title ?? "",
        url: r.url,
        description: r.description ?? "",
      })),
    };
  },
});

export const scrapeAndPersist = action({
  args: {
    url: v.string(),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ id: string; url: string; title: string; summary: string; markdown: string; ragEntryId: string | null }> => {
    const client = getClient();
    const result = await client.scrape(args.url, {
      formats: ["markdown", "summary"],
    });

    const now = Date.now();
    const id: string = await ctx.runMutation(internal.regulations.insertRegulation, {
      sourceUrl: args.url,
      agency: result.metadata?.ogSiteName ?? "Unknown",
      extractedText: result.markdown ?? "",
      summary: result.summary ?? result.metadata?.title ?? "",
      affectedProjectIds: args.projectId ? [args.projectId] : [],
      crawledAt: now,
      isNew: true,
    });

    let ragEntryId: string | null = null;
    try {
      const { rag } = await import("./rag");
      const namespace = args.projectId ? `project-${args.projectId}` : "global";
      const r = await rag.add(ctx, {
        namespace,
        key: args.url,
        text: `${result.metadata?.title ?? args.url}\n\nAgency: ${result.metadata?.ogSiteName ?? "Unknown"}\n\n${result.summary ?? ""}\n\n${result.markdown ?? ""}`,
        title: result.metadata?.title ?? args.url,
        importance: 0.7,
      });
      ragEntryId = r.entryId as unknown as string;
    } catch (e) {
      console.error("Failed to add to RAG:", e);
    }

    return {
      id,
      url: args.url,
      title: result.metadata?.title ?? "",
      summary: result.summary ?? "",
      markdown: result.markdown ?? "",
      ragEntryId,
    };
  },
});
