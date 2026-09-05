"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const warmBackupPoolTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ pairs: number; warmed: number }> => {
    const pairs = await ctx.runQuery(internal.escalationBridge.listLocationsAndRoles, {});
    let warmed = 0;
    for (const p of pairs) {
      const r = await ctx.runAction(internal.escalationBridge.warmBackupPool, {
        location: p.location,
        role: p.role,
      });
      warmed += (r as { inserted: number }).inserted;
    }
    return { pairs: pairs.length, warmed };
  },
});
