"use node";
import { action } from "./_generated/server";
import { env } from "./_generated/server";
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
