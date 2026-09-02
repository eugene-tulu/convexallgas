import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const checkDueObligations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const dueObligations = await ctx.db
      .query("obligations")
      .withIndex("by_nextCheckAt", (q) => q.lte("nextCheckAt", now))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    const results = [];
    for (const obligation of dueObligations) {
      const isOverdue = obligation.deadline < now;

      if (isOverdue) {
        await ctx.db.patch(obligation._id, { status: "overdue" });
        results.push({ id: obligation._id, status: "overdue", commitmentText: obligation.commitmentText });
      }
    }

    for (const obligation of dueObligations) {
      const project = await ctx.db.get(obligation.projectId);
      if (!project) continue;

      await ctx.scheduler.runAfter(0, internal.reminders.sendReminderEmail, {
        projectName: project.name,
        obligationText: obligation.commitmentText,
        deadline: obligation.deadline,
      });
    }

    if (results.length > 0) {
      await ctx.runMutation(internal.eventLog.logEvent, {
        table: "obligations",
        rowId: "cron-check",
        action: "reminder",
        summary: `${results.length} obligations marked overdue, reminder emails scheduled`,
      });
    }

    return results;
  },
});
