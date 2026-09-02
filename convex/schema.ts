import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    jurisdiction: v.string(),
    projectType: v.string(),
    status: v.string(),
    contactEmail: v.optional(v.string()),
  }).index("by_jurisdiction", ["jurisdiction"]),

  regulations: defineTable({
    sourceUrl: v.string(),
    agency: v.string(),
    extractedText: v.string(),
    summary: v.string(),
    affectedProjectIds: v.array(v.id("projects")),
    crawledAt: v.number(),
    isNew: v.boolean(),
  }).index("by_crawledAt", ["crawledAt"]),

  documents: defineTable({
    projectId: v.id("projects"),
    source: v.string(),
    content: v.string(),
    embedding: v.optional(v.array(v.float64())),
  }).index("by_project", ["projectId"]),

  obligations: defineTable({
    projectId: v.id("projects"),
    commitmentText: v.string(),
    deadline: v.number(),
    recurrence: v.string(),
    nextCheckAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("completed"),
      v.literal("overdue"),
    ),
    verificationUrl: v.optional(v.string()),
    lastCompletedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_nextCheckAt", ["nextCheckAt"]),

  events: defineTable({
    table: v.string(),
    rowId: v.string(),
    action: v.string(),
    timestamp: v.number(),
    summary: v.string(),
  }).index("by_timestamp", ["timestamp"]),
});
