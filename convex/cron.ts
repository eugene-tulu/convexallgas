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
    let remindersSent = 0;
    let remindersSkipped = 0;

    for (const obligation of dueObligations) {
      const isOverdue = obligation.deadline < now;

      if (isOverdue) {
        await ctx.db.patch(obligation._id, { status: "overdue" });
        results.push({ id: obligation._id, status: "overdue", commitmentText: obligation.commitmentText });
      }

      const project = await ctx.db.get(obligation.projectId);
      if (!project) continue;

      const recipient = project.contactEmail;
      if (!recipient || !recipient.includes("@")) {
        remindersSkipped++;
        await ctx.runMutation(internal.eventLog.logEvent, {
          table: "obligations",
          rowId: obligation._id,
          action: "reminder-skipped",
          summary: `No contactEmail on project "${project.name}" - reminder skipped`,
        });
        continue;
      }

      await ctx.scheduler.runAfter(0, internal.reminders.sendReminderEmail, {
        projectName: project.name,
        obligationId: obligation._id,
        obligationText: obligation.commitmentText,
        deadline: obligation.deadline,
        recipient,
      });
      remindersSent++;
    }

    if (results.length > 0 || remindersSent > 0 || remindersSkipped > 0) {
      await ctx.runMutation(internal.eventLog.logEvent, {
        table: "obligations",
        rowId: "cron-check",
        action: "reminder",
        summary: `${results.length} overdue, ${remindersSent} reminders sent, ${remindersSkipped} skipped (no contactEmail)`,
      });
    }

    return { overdue: results.length, remindersSent, remindersSkipped };
  },
});
