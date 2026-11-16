import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { unsubscribeRoute as commentUnsubscribeRoute } from "./commentUnsubscribe";
import { donationCallback } from "./donations";
import { paypalWebhook } from "./paypal";
import { unsubscribeRoute } from "./unsubscribe";
import {
  apiNotFoundRoute,
  apiPreflightRoute,
  organizationsRoute,
} from "./publicApi";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/sasapay/donations/callback",
  method: "POST",
  handler: donationCallback,
});

http.route({
  path: "/paypal/webhook",
  method: "POST",
  handler: paypalWebhook,
});

// The unsubscribe link in update emails (see unsubscribe.ts).
http.route({
  pathPrefix: "/email/unsubscribe/",
  method: "POST",
  handler: unsubscribeRoute,
});

http.route({
  pathPrefix: "/email/unsubscribe/",
  method: "GET",
  handler: unsubscribeRoute,
});

// The unsubscribe link in comment emails (see commentUnsubscribe.ts). The
// trailing slash keeps this from matching the update emails' prefix above.
http.route({
  pathPrefix: "/email/unsubscribe-comments/",
  method: "POST",
  handler: commentUnsubscribeRoute,
});

http.route({
  pathPrefix: "/email/unsubscribe-comments/",
  method: "GET",
  handler: commentUnsubscribeRoute,
});

// Public read-only API (see publicApi.ts). The more specific prefix wins, so
// the catch-all only sees paths that aren't a real endpoint.
http.route({
  pathPrefix: "/api/v1/organizations/",
  method: "GET",
  handler: organizationsRoute,
});

http.route({
  pathPrefix: "/api/v1/",
  method: "GET",
  handler: apiNotFoundRoute,
});

http.route({
  pathPrefix: "/api/v1/",
  method: "OPTIONS",
  handler: apiPreflightRoute,
});

export default http;
