/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as cron from "../cron.js";
import type * as crons from "../crons.js";
import type * as documents from "../documents.js";
import type * as eventLog from "../eventLog.js";
import type * as firecrawl from "../firecrawl.js";
import type * as http from "../http.js";
import type * as llm from "../llm.js";
import type * as mail from "../mail.js";
import type * as obligations from "../obligations.js";
import type * as projects from "../projects.js";
import type * as regulations from "../regulations.js";
import type * as search from "../search.js";
import type * as seed from "../seed.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  cron: typeof cron;
  crons: typeof crons;
  documents: typeof documents;
  eventLog: typeof eventLog;
  firecrawl: typeof firecrawl;
  http: typeof http;
  llm: typeof llm;
  mail: typeof mail;
  obligations: typeof obligations;
  projects: typeof projects;
  regulations: typeof regulations;
  search: typeof search;
  seed: typeof seed;
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
