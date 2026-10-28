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
