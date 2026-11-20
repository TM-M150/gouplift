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
import type * as beneficialOwners from "../beneficialOwners.js";
import type * as commentEmails from "../commentEmails.js";
import type * as commentUnsubscribe from "../commentUnsubscribe.js";
import type * as crons from "../crons.js";
import type * as customerRisk from "../customerRisk.js";
import type * as documentUploads from "../documentUploads.js";
import type * as donations from "../donations.js";
import type * as fundraiser from "../fundraiser.js";
import type * as fundraiserComments from "../fundraiserComments.js";
import type * as fundraiserExpiry from "../fundraiserExpiry.js";
import type * as fundraiserUpdates from "../fundraiserUpdates.js";
import type * as guestComments from "../guestComments.js";
import type * as http from "../http.js";
import type * as impact from "../impact.js";
import type * as kyc from "../kyc.js";
import type * as kycReview from "../kycReview.js";
import type * as lib_adminAudit from "../lib/adminAudit.js";
import type * as lib_beneficialOwnerValidators from "../lib/beneficialOwnerValidators.js";
import type * as lib_commentEmail from "../lib/commentEmail.js";
import type * as lib_constants from "../lib/constants.js";
import type * as lib_documentFiles from "../lib/documentFiles.js";
import type * as lib_donationGate from "../lib/donationGate.js";
import type * as lib_donationSource from "../lib/donationSource.js";
import type * as lib_email from "../lib/email.js";
import type * as lib_emailConfirmation from "../lib/emailConfirmation.js";
import type * as lib_emailConfirmed from "../lib/emailConfirmed.js";
import type * as lib_fundraiserAccess from "../lib/fundraiserAccess.js";
import type * as lib_fundraiserTotals from "../lib/fundraiserTotals.js";
import type * as lib_fx from "../lib/fx.js";
import type * as lib_googleAutoLink from "../lib/googleAutoLink.js";
import type * as lib_kenyanPhone from "../lib/kenyanPhone.js";
import type * as lib_kycTier from "../lib/kycTier.js";
import type * as lib_kycValidators from "../lib/kycValidators.js";
import type * as lib_mlro from "../lib/mlro.js";
import type * as lib_orgAccess from "../lib/orgAccess.js";
import type * as lib_organizationRisk from "../lib/organizationRisk.js";
import type * as lib_organizationValidators from "../lib/organizationValidators.js";
import type * as lib_payoutAccountValidators from "../lib/payoutAccountValidators.js";
import type * as lib_payoutAccounts from "../lib/payoutAccounts.js";
import type * as lib_payoutBalance from "../lib/payoutBalance.js";
import type * as lib_payoutEligibility from "../lib/payoutEligibility.js";
import type * as lib_payouts from "../lib/payouts.js";
import type * as lib_paypalRefunds from "../lib/paypalRefunds.js";
import type * as lib_phoneBackfill from "../lib/phoneBackfill.js";
import type * as lib_publicOrganizations from "../lib/publicOrganizations.js";
import type * as lib_randomToken from "../lib/randomToken.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_receiptEmail from "../lib/receiptEmail.js";
import type * as lib_refunds from "../lib/refunds.js";
import type * as lib_riskProfile from "../lib/riskProfile.js";
import type * as lib_riskValidators from "../lib/riskValidators.js";
import type * as lib_signInRules from "../lib/signInRules.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_staff from "../lib/staff.js";
import type * as lib_turnstile from "../lib/turnstile.js";
import type * as lib_updateEmail from "../lib/updateEmail.js";
import type * as lib_updateOptOuts from "../lib/updateOptOuts.js";
import type * as lib_verificationEmail from "../lib/verificationEmail.js";
import type * as lib_webhookConfig from "../lib/webhookConfig.js";
import type * as lib_webhookPayloads from "../lib/webhookPayloads.js";
import type * as lib_webhookQueue from "../lib/webhookQueue.js";
import type * as lib_webhookSend from "../lib/webhookSend.js";
import type * as lib_webhookSignature from "../lib/webhookSignature.js";
import type * as lib_webhookValidators from "../lib/webhookValidators.js";
import type * as newsletter from "../newsletter.js";
import type * as organizationRisk from "../organizationRisk.js";
import type * as organizations from "../organizations.js";
import type * as payoutAccountReview from "../payoutAccountReview.js";
import type * as payoutAccounts from "../payoutAccounts.js";
import type * as payoutBalances from "../payoutBalances.js";
import type * as payouts from "../payouts.js";
import type * as paypal from "../paypal.js";
import type * as phoneNumbers from "../phoneNumbers.js";
import type * as platformStats from "../platformStats.js";
import type * as publicApi from "../publicApi.js";
import type * as receipts from "../receipts.js";
import type * as reconcileTotals from "../reconcileTotals.js";
import type * as refunds from "../refunds.js";
import type * as sasapay from "../sasapay.js";
import type * as sitemap from "../sitemap.js";
import type * as testimonials from "../testimonials.js";
import type * as unsubscribe from "../unsubscribe.js";
import type * as updateEmails from "../updateEmails.js";
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
  beneficialOwners: typeof beneficialOwners;
  commentEmails: typeof commentEmails;
  commentUnsubscribe: typeof commentUnsubscribe;
  crons: typeof crons;
  customerRisk: typeof customerRisk;
  documentUploads: typeof documentUploads;
  donations: typeof donations;
  fundraiser: typeof fundraiser;
  fundraiserComments: typeof fundraiserComments;
  fundraiserExpiry: typeof fundraiserExpiry;
  fundraiserUpdates: typeof fundraiserUpdates;
  guestComments: typeof guestComments;
  http: typeof http;
  impact: typeof impact;
  kyc: typeof kyc;
  kycReview: typeof kycReview;
  "lib/adminAudit": typeof lib_adminAudit;
  "lib/beneficialOwnerValidators": typeof lib_beneficialOwnerValidators;
  "lib/commentEmail": typeof lib_commentEmail;
  "lib/constants": typeof lib_constants;
  "lib/documentFiles": typeof lib_documentFiles;
  "lib/donationGate": typeof lib_donationGate;
  "lib/donationSource": typeof lib_donationSource;
  "lib/email": typeof lib_email;
  "lib/emailConfirmation": typeof lib_emailConfirmation;
  "lib/emailConfirmed": typeof lib_emailConfirmed;
  "lib/fundraiserAccess": typeof lib_fundraiserAccess;
  "lib/fundraiserTotals": typeof lib_fundraiserTotals;
  "lib/fx": typeof lib_fx;
  "lib/googleAutoLink": typeof lib_googleAutoLink;
  "lib/kenyanPhone": typeof lib_kenyanPhone;
  "lib/kycTier": typeof lib_kycTier;
  "lib/kycValidators": typeof lib_kycValidators;
  "lib/mlro": typeof lib_mlro;
  "lib/orgAccess": typeof lib_orgAccess;
  "lib/organizationRisk": typeof lib_organizationRisk;
  "lib/organizationValidators": typeof lib_organizationValidators;
  "lib/payoutAccountValidators": typeof lib_payoutAccountValidators;
  "lib/payoutAccounts": typeof lib_payoutAccounts;
  "lib/payoutBalance": typeof lib_payoutBalance;
  "lib/payoutEligibility": typeof lib_payoutEligibility;
  "lib/payouts": typeof lib_payouts;
  "lib/paypalRefunds": typeof lib_paypalRefunds;
  "lib/phoneBackfill": typeof lib_phoneBackfill;
  "lib/publicOrganizations": typeof lib_publicOrganizations;
  "lib/randomToken": typeof lib_randomToken;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/receiptEmail": typeof lib_receiptEmail;
  "lib/refunds": typeof lib_refunds;
  "lib/riskProfile": typeof lib_riskProfile;
  "lib/riskValidators": typeof lib_riskValidators;
  "lib/signInRules": typeof lib_signInRules;
  "lib/slug": typeof lib_slug;
  "lib/staff": typeof lib_staff;
  "lib/turnstile": typeof lib_turnstile;
  "lib/updateEmail": typeof lib_updateEmail;
  "lib/updateOptOuts": typeof lib_updateOptOuts;
  "lib/verificationEmail": typeof lib_verificationEmail;
  "lib/webhookConfig": typeof lib_webhookConfig;
  "lib/webhookPayloads": typeof lib_webhookPayloads;
  "lib/webhookQueue": typeof lib_webhookQueue;
  "lib/webhookSend": typeof lib_webhookSend;
  "lib/webhookSignature": typeof lib_webhookSignature;
  "lib/webhookValidators": typeof lib_webhookValidators;
  newsletter: typeof newsletter;
  organizationRisk: typeof organizationRisk;
  organizations: typeof organizations;
  payoutAccountReview: typeof payoutAccountReview;
  payoutAccounts: typeof payoutAccounts;
  payoutBalances: typeof payoutBalances;
  payouts: typeof payouts;
  paypal: typeof paypal;
  phoneNumbers: typeof phoneNumbers;
  platformStats: typeof platformStats;
  publicApi: typeof publicApi;
  receipts: typeof receipts;
  reconcileTotals: typeof reconcileTotals;
  refunds: typeof refunds;
  sasapay: typeof sasapay;
  sitemap: typeof sitemap;
  testimonials: typeof testimonials;
  unsubscribe: typeof unsubscribe;
  updateEmails: typeof updateEmails;
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
