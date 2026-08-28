import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import { donationCallback } from "./donations";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

http.route({
  path: "/sasapay/donations/callback",
  method: "POST",
  handler: donationCallback,
});

export default http;