import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { donationCallback } from "./donations";
import { paypalWebhook } from "./paypal";
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
