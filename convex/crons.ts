import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "check obligation deadlines",
  { minutes: 30 },
  internal.cron.checkDueObligations
);

export default crons;
