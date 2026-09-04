import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("check escalations", { minutes: 1 }, internal.escalation.checkEscalations, {});
crons.interval("warm backup pool", { hours: 6 }, internal.warmPool.warmBackupPoolTick, {});

export default crons;
