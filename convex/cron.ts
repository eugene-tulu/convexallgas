import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const checkDueObligations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const dueObligations = await ctx.db
      .query("obligations")
      .withIndex("by_nextCheckAt", (q) => q.lte("nextCheckAt", now))
      .filter((q) => q.neq(q.field("status"), "completed"))
      .collect();

    const results = [];
    for (const obligation of dueObligations) {
      if (obligation.deadline < now) {
        await ctx.db.patch(obligation._id, { status: "overdue" });
        results.push({ id: obligation._id, status: "overdue" });
      } else {
        results.push({ id: obligation._id, commitmentText: obligation.commitmentText });
      }
    }

    if (results.length > 0) {
      await ctx.runMutation(internal.eventLog.logEvent, {
        table: "obligations",
        rowId: "cron-check",
        action: "reminder",
        summary: `${results.length} obligations due or overdue`,
      });
    }

    return results;
  },
});
