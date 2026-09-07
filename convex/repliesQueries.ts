import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";


const SHIFT_TAG_RE = /\[shift:([a-zA-Z0-9_-]+)\]/;

export const shortlist = query({
  args: { shiftId: v.id("shifts") },
  handler: async (ctx, args) => {
    const responses = await ctx.db
      .query("responses")
      .withIndex("by_shiftId_receivedAt", (q) => q.eq("shiftId", args.shiftId))
      .order("asc")
      .collect();
    // Batch-load all workers for this shift in a single query, then index by id.
    const workerIds = Array.from(
      new Set(responses.map((r) => r.workerId).filter((id): id is NonNullable<typeof id> => !!id))
    );
    const workers = workerIds.length
      ? await ctx.db
          .query("workers")
          .filter((q) =>
            q.or(...workerIds.map((id) => q.eq(q.field("_id"), id)))
          )
          .collect()
      : [];
    const workerById = new Map(workers.map((w) => [w._id, w]));
    const out = responses.map((r) => {
      const w = r.workerId ? workerById.get(r.workerId) : null;
      return {
        ...r,
        worker: w
          ? { name: w.name, contact: w.contact, reliabilityScore: w.reliabilityScore }
          : null,
      };
    });
    return out.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
  },
});

export const approveCandidate = mutation({
  args: {
    shiftId: v.id("shifts"),
    responseId: v.id("responses"),
  },
  handler: async (ctx, args) => {
    const shift = await ctx.db.get(args.shiftId);
    if (!shift) throw new Error("Shift not found");
    // Approval is valid from any of the three "open" statuses: the shift
    // can be broadcasting (manager approves an internal candidate before
    // the cron escalates), shortlist_ready (a reply came in and the
    // manager picks a winner), or escalating (the internal roster timed
    // out and external candidates are now in play). A shift that's
    // already confirmed or cancelled lost the race.
    if (
      shift.status !== "broadcasting" &&
      shift.status !== "shortlist_ready" &&
      shift.status !== "escalating"
    ) {
      // Don't throw — log the race-loss and return so the events row actually commits.
      // The caller can detect this via `confirmed: false`.
      await ctx.db.insert("events", {
        table: "shifts",
        rowId: shift._id,
        action: "approval_lost_race",
        timestamp: Date.now(),
        summary: `Approval attempt for response ${args.responseId} lost the race - shift already in status "${shift.status}"`,
      });
      return { confirmed: false, reason: "lost_race", currentStatus: shift.status };
    }
    const response = await ctx.db.get(args.responseId);
    if (!response) throw new Error("Response not found");
    if (response.shiftId !== shift._id) throw new Error("Response is for a different shift");

    const now = Date.now();
    const isExternal = response.source === "external";
    // Build a paper-trail summary that includes the external sourceUrl when
    // relevant, so the audit log shows where the candidate came from.
    const sourceTag = isExternal
      ? `external candidate (${response.externalSourceUrl ?? "no source url"})`
      : `internal response ${args.responseId}`;
    await ctx.db.patch(shift._id, {
      status: "confirmed",
      confirmedAt: now,
      confirmedByResponseId: args.responseId,
    });
    await ctx.db.insert("events", {
      table: "shifts",
      rowId: shift._id,
      action: "shift_confirmed",
      timestamp: now,
      summary: `Confirmed by ${sourceTag} (elapsed ${Math.round(
        (now - (shift.broadcastAt ?? now)) / 1000
      )}s from broadcast)${isExternal ? " — manager will contact the candidate via the source URL" : ""}`,
    });

    // For internal wins, schedule the warm confirm/reject emails. For
    // external wins there is no worker contact in the system — the
    // manager is responsible for reaching out via the source URL.
    if (!isExternal) {
      await ctx.scheduler.runAfter(0, internal.repliesBridge.sendConfirmAndRejects, {
        shiftId: shift._id,
        winningResponseId: args.responseId,
      });
    } else {
      await ctx.db.insert("events", {
        table: "responses",
        rowId: args.responseId,
        action: "external_confirmed",
        timestamp: now,
        summary: `Manager approved external candidate from ${response.externalSourceUrl ?? "unknown source"}. Contact is the manager's responsibility.`,
      });
    }
    return { confirmed: true, confirmedAt: now, external: isExternal };
  },
});
