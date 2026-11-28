import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import { canonicalHostRedirects } from "./lib/seo";

// Convex serves HTTP routes from the .convex.site domain. The public API
// (convex/publicApi.ts) is exposed on our own domain instead, so partner
// sites call https://<our domain>/api/v1/... and never learn which backend
// answers. Same variable lib/auth-server.ts already uses.
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
  // Which kind of deployment this is: "production", "preview" or, anywhere
  // that isn't Vercel, "development". Put into the browser code as well, so
  // lib/sentry.ts only reports errors from the live site.
  env: {
    NEXT_PUBLIC_APP_ENV: process.env.VERCEL_ENV ?? "development",
  },
  // Who may put our pages inside an iframe. Only the embed widget
  // (app/embed, loaded by public/embed.js) is meant to appear on other
  // people's sites; every other page, donation dialog included, may only be
  // framed by ourselves so it can't be disguised under a fake page
  // (clickjacking). Two rules that match the same path would override each
  // other, so the first one explicitly leaves /embed out.
  async headers() {
    return [
      {
        source: "/((?!embed(?:/|$)).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
      {
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
  // The fonts the fundraiser share card is drawn with are read from disk when
  // it is made, so they are named here to be shipped with that route. (`*`
  // stands for the [id] part: in a key, square brackets mean something else.)
  outputFileTracingIncludes: {
    "/fundraiser/*/share-image": ["./assets/fonts/**/*"],
  },
  // gouplift.co.ke is only a way in: it sends people to the real site.
  async redirects() {
    return canonicalHostRedirects();
  },
  async rewrites() {
    if (!convexSiteUrl) {
      console.warn(
        "NEXT_PUBLIC_CONVEX_SITE_URL is not set, so /api/v1 will not be proxied to Convex.",
      );
      return [];
    }
    return [
      {
        source: "/api/v1/:path*",
        destination: `${convexSiteUrl}/api/v1/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: "https",
        hostname: "*.convex.cloud",
      },
    ],
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/sourcemaps/uploading/bundler-plugin-options/

  org: "gouplift-ltd",

  project: "gouplift",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
