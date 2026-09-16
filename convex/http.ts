import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { donationCallback } from "./donations";
import { paypalWebhook } from "./paypal";

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

export default http;
