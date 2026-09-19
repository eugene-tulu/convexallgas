import { v } from "convex/values";
import { query } from "./_generated/server";
import schema from "./schema";

export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(schema.doc("events")),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await ctx.db
      .query("events")
      .withIndex("by_owner_timestamp", (q) =>
        q.eq("ownerId", identity.tokenIdentifier),
      )
      .order("desc")
      .take(Math.min(args.limit ?? 100, 100));
  },
});

export const forHunt = query({
  args: { huntId: v.id("hunts") },
  returns: v.array(schema.doc("events")),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const hunt = await ctx.db.get(args.huntId);
    if (!hunt || hunt.ownerId !== identity.tokenIdentifier)
      throw new Error("Not authorized");
    const all = await ctx.db
      .query("events")
      .withIndex("by_table_rowId", (q) =>
        q.eq("table", "hunts").eq("rowId", args.huntId)
      )
      .order("desc")
      .take(50);
    return all;
  },
});
