/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentStatus from "../agentStatus.js";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as journal from "../journal.js";
import type * as lib_guards from "../lib/guards.js";
import type * as lib_testUser from "../lib/testUser.js";
import type * as prompts from "../prompts.js";
import type * as sessions from "../sessions.js";
import type * as snapshots from "../snapshots.js";
import type * as sync from "../sync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentStatus: typeof agentStatus;
  auth: typeof auth;
  http: typeof http;
  jobs: typeof jobs;
  journal: typeof journal;
  "lib/guards": typeof lib_guards;
  "lib/testUser": typeof lib_testUser;
  prompts: typeof prompts;
  sessions: typeof sessions;
  snapshots: typeof snapshots;
  sync: typeof sync;
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
