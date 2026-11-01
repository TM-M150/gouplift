/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as donations from "../donations.js";
import type * as fundraiser from "../fundraiser.js";
import type * as http from "../http.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_donationSource from "../lib/donationSource.js";
import type * as lib_fx from "../lib/fx.js";
import type * as lib_orgAccess from "../lib/orgAccess.js";
import type * as lib_organizationValidators from "../lib/organizationValidators.js";
import type * as lib_publicOrganizations from "../lib/publicOrganizations.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_staff from "../lib/staff.js";
import type * as lib_turnstile from "../lib/turnstile.js";
import type * as lib_webhookConfig from "../lib/webhookConfig.js";
import type * as lib_webhookPayloads from "../lib/webhookPayloads.js";
import type * as lib_webhookQueue from "../lib/webhookQueue.js";
import type * as lib_webhookSend from "../lib/webhookSend.js";
import type * as lib_webhookSignature from "../lib/webhookSignature.js";
import type * as lib_webhookValidators from "../lib/webhookValidators.js";
import type * as organizations from "../organizations.js";
import type * as paypal from "../paypal.js";
import type * as publicApi from "../publicApi.js";
import type * as sasapay from "../sasapay.js";
import type * as users from "../users.js";
import type * as webhookDelivery from "../webhookDelivery.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  donations: typeof donations;
  fundraiser: typeof fundraiser;
  http: typeof http;
  "lib/constants": typeof lib_constants;
  "lib/donationSource": typeof lib_donationSource;
  "lib/fx": typeof lib_fx;
  "lib/orgAccess": typeof lib_orgAccess;
  "lib/organizationValidators": typeof lib_organizationValidators;
  "lib/publicOrganizations": typeof lib_publicOrganizations;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/slug": typeof lib_slug;
  "lib/staff": typeof lib_staff;
  "lib/turnstile": typeof lib_turnstile;
  "lib/webhookConfig": typeof lib_webhookConfig;
  "lib/webhookPayloads": typeof lib_webhookPayloads;
  "lib/webhookQueue": typeof lib_webhookQueue;
  "lib/webhookSend": typeof lib_webhookSend;
  "lib/webhookSignature": typeof lib_webhookSignature;
  "lib/webhookValidators": typeof lib_webhookValidators;
  organizations: typeof organizations;
  paypal: typeof paypal;
  publicApi: typeof publicApi;
  sasapay: typeof sasapay;
  users: typeof users;
  webhookDelivery: typeof webhookDelivery;
  webhooks: typeof webhooks;
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
