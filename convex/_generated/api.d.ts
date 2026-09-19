/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentThreads from "../agentThreads.js";
import type * as agentmailIdempotency from "../agentmailIdempotency.js";
import type * as auctionWatches from "../auctionWatches.js";
import type * as auth from "../auth.js";
import type * as candidates from "../candidates.js";
import type * as crons from "../crons.js";
import type * as discovery from "../discovery.js";
import type * as events from "../events.js";
import type * as eventsLog from "../eventsLog.js";
import type * as firecrawl from "../firecrawl.js";
import type * as garageBriefActions from "../garageBriefActions.js";
import type * as garageBriefs from "../garageBriefs.js";
import type * as http from "../http.js";
import type * as hunt from "../hunt.js";
import type * as huntFeedback from "../huntFeedback.js";
import type * as huntRuns from "../huntRuns.js";
import type * as hunts from "../hunts.js";
import type * as inboundActions from "../inboundActions.js";
import type * as inbox from "../inbox.js";
import type * as listingEvidence from "../listingEvidence.js";
import type * as llm from "../llm.js";
import type * as mail from "../mail.js";
import type * as market from "../market.js";
import type * as monitorChecks from "../monitorChecks.js";
import type * as notifications from "../notifications.js";
import type * as operationalIssues from "../operationalIssues.js";
import type * as outreach from "../outreach.js";
import type * as outreachActions from "../outreachActions.js";
import type * as outreachBridge from "../outreachBridge.js";
import type * as preferences from "../preferences.js";
import type * as rateLimit from "../rateLimit.js";
import type * as retention from "../retention.js";
import type * as searchQueries from "../searchQueries.js";
import type * as sourceRegistry from "../sourceRegistry.js";
import type * as verify from "../verify.js";
import type * as webhookEvents from "../webhookEvents.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentThreads: typeof agentThreads;
  agentmailIdempotency: typeof agentmailIdempotency;
  auctionWatches: typeof auctionWatches;
  auth: typeof auth;
  candidates: typeof candidates;
  crons: typeof crons;
  discovery: typeof discovery;
  events: typeof events;
  eventsLog: typeof eventsLog;
  firecrawl: typeof firecrawl;
  garageBriefActions: typeof garageBriefActions;
  garageBriefs: typeof garageBriefs;
  http: typeof http;
  hunt: typeof hunt;
  huntFeedback: typeof huntFeedback;
  huntRuns: typeof huntRuns;
  hunts: typeof hunts;
  inboundActions: typeof inboundActions;
  inbox: typeof inbox;
  listingEvidence: typeof listingEvidence;
  llm: typeof llm;
  mail: typeof mail;
  market: typeof market;
  monitorChecks: typeof monitorChecks;
  notifications: typeof notifications;
  operationalIssues: typeof operationalIssues;
  outreach: typeof outreach;
  outreachActions: typeof outreachActions;
  outreachBridge: typeof outreachBridge;
  preferences: typeof preferences;
  rateLimit: typeof rateLimit;
  retention: typeof retention;
  searchQueries: typeof searchQueries;
  sourceRegistry: typeof sourceRegistry;
  verify: typeof verify;
  webhookEvents: typeof webhookEvents;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
