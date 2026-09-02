import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_jurisdiction", (q) => q.eq("jurisdiction", "California"))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (existing) {
      return { alreadySeeded: true, projectId: existing._id };
    }

    const now = Date.now();

    const projectId = await ctx.db.insert("projects", {
      name: "Merced Solar Wind Farm EIA",
      jurisdiction: "California",
      projectType: "Wind",
      status: "active",
      contactEmail: "compliance-officer@merced-solar.example.com",
    });

    await ctx.db.insert("obligations", {
      projectId,
      commitmentText: "Submit quarterly groundwater monitoring report",
      deadline: now + 14 * 24 * 60 * 60 * 1000,
      recurrence: "90d",
      nextCheckAt: now + 7 * 24 * 60 * 60 * 1000,
      status: "pending",
    });

    await ctx.db.insert("obligations", {
      projectId,
      commitmentText: "File annual avian/bat impact assessment",
      deadline: now + 30 * 24 * 60 * 60 * 1000,
      recurrence: "365d",
      nextCheckAt: now + 23 * 24 * 60 * 60 * 1000,
      status: "pending",
    });

    await ctx.db.insert("documents", {
      projectId,
      source: "Merced Solar — Post-Construction Monitoring Report, 2022",
      content:
        "Mitigation measure: Bat acoustic deterrent deployment at Merced Solar site, 2022. " +
        "The deterrent reduced bat fatalities by 67% compared to pre-installation baseline. " +
        "Operational from March to November, active during peak migration periods. " +
        "Recommendation: Extend deployment duration for 2023 monitoring cycle.",
    });

    await ctx.db.insert("documents", {
      projectId,
      source: "CDFW Comments on Draft EIA, February 2021",
      content:
        "Agency response: California Department of Fish and Wildlife noted that the " +
        "bat monitoring protocol should be expanded to include summer maternity roost " +
        "sites. The Department recommended a revised statistical model for fatality " +
        "estimation that accounts for carcass displacement under operational turbines.",
    });

    await ctx.db.insert("documents", {
      projectId,
      source: "Noise Monitoring Protocol for Wind Facilities, 2020",
      content:
        "Standard protocol for measuring turbine noise at wind facilities in California. " +
        "Measurements taken at 70m from turbine base during operation. Sound pressure " +
        "levels averaged over 10-minute intervals. Compliance threshold: 45 dBA at " +
        "project boundary during nighttime hours.",
    });

    await ctx.runMutation(internal.eventLog.logEvent, {
      table: "seed",
      rowId: "demo",
      action: "initialized",
      summary:
        "Seeded demo project 'Merced Solar Wind Farm EIA' with 2 obligations, 3 documents",
    });

    return { alreadySeeded: false, projectId };
  },
});
