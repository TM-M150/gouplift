/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as donations from "../donations.js";
import type * as fundraiser from "../fundraiser.js";
import type * as http from "../http.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_fx from "../lib/fx.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_turnstile from "../lib/turnstile.js";
import type * as organizations from "../organizations.js";
import type * as paypal from "../paypal.js";
import type * as sasapay from "../sasapay.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  donations: typeof donations;
  fundraiser: typeof fundraiser;
  http: typeof http;
  "lib/constants": typeof lib_constants;
  "lib/fx": typeof lib_fx;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/turnstile": typeof lib_turnstile;
  organizations: typeof organizations;
  paypal: typeof paypal;
  sasapay: typeof sasapay;
  users: typeof users;
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
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};
