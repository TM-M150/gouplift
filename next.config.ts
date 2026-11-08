import type { NextConfig } from "next";

// Convex serves HTTP routes from the .convex.site domain. The public API
// (convex/publicApi.ts) is exposed on our own domain instead, so partner
// sites call https://<our domain>/api/v1/... and never learn which backend
// answers. Same variable lib/auth-server.ts already uses.
const convexSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL?.replace(
  /\/+$/,
  "",
);

const nextConfig: NextConfig = {
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

export default nextConfig;
