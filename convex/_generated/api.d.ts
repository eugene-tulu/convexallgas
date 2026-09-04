/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as businesses from "../businesses.js";
import type * as businessesBridge from "../businessesBridge.js";
import type * as businessesQueries from "../businessesQueries.js";
import type * as crons from "../crons.js";
import type * as escalation from "../escalation.js";
import type * as escalationBridge from "../escalationBridge.js";
import type * as events from "../events.js";
import type * as eventsLog from "../eventsLog.js";
import type * as firecrawl from "../firecrawl.js";
import type * as http from "../http.js";
import type * as llm from "../llm.js";
import type * as llmTaskBridge from "../llmTaskBridge.js";
import type * as llmTasks from "../llmTasks.js";
import type * as mail from "../mail.js";
import type * as mailBridge from "../mailBridge.js";
import type * as optIn from "../optIn.js";
import type * as optInHttp from "../optInHttp.js";
import type * as replies from "../replies.js";
import type * as repliesActions from "../repliesActions.js";
import type * as repliesBridge from "../repliesBridge.js";
import type * as repliesQueries from "../repliesQueries.js";
import type * as seed from "../seed.js";
import type * as seedAction from "../seedAction.js";
import type * as seedBridge from "../seedBridge.js";
import type * as shifts from "../shifts.js";
import type * as shiftsActions from "../shiftsActions.js";
import type * as shiftsBridge from "../shiftsBridge.js";
import type * as testActions from "../testActions.js";
import type * as warmPool from "../warmPool.js";
import type * as workers from "../workers.js";
import type * as workersBridge from "../workersBridge.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  businesses: typeof businesses;
  businessesBridge: typeof businessesBridge;
  businessesQueries: typeof businessesQueries;
  crons: typeof crons;
  escalation: typeof escalation;
  escalationBridge: typeof escalationBridge;
  events: typeof events;
  eventsLog: typeof eventsLog;
  firecrawl: typeof firecrawl;
  http: typeof http;
  llm: typeof llm;
  llmTaskBridge: typeof llmTaskBridge;
  llmTasks: typeof llmTasks;
  mail: typeof mail;
  mailBridge: typeof mailBridge;
  optIn: typeof optIn;
  optInHttp: typeof optInHttp;
  replies: typeof replies;
  repliesActions: typeof repliesActions;
  repliesBridge: typeof repliesBridge;
  repliesQueries: typeof repliesQueries;
  seed: typeof seed;
  seedAction: typeof seedAction;
  seedBridge: typeof seedBridge;
  shifts: typeof shifts;
  shiftsActions: typeof shiftsActions;
  shiftsBridge: typeof shiftsBridge;
  testActions: typeof testActions;
  warmPool: typeof warmPool;
  workers: typeof workers;
  workersBridge: typeof workersBridge;
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

export declare const components: {};
