import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("run active hunts", { minutes: 15 }, internal.hunt.runActiveHunts, {});
crons.interval(
  "recover queued email updates",
  { minutes: 5 },
  internal.hunt.retryQueuedNotifications,
  {},
);
crons.cron(
  "purge expired operational data",
  "15 3 * * *",
  internal.retention.runPurge,
  {},
);
crons.interval(
  "send due Auction Watch timing alerts",
  { minutes: 5 },
  internal.firecrawl.runDueAuctionAlerts,
  {},
);
crons.cron(
  "prepare weekly Garage Briefs",
  "0 * * * *",
  internal.garageBriefActions.runDueBriefs,
  {},
);
export default crons;
