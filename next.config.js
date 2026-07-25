/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" bundles a minimal server for Docker/self-hosted. Vercel ignores
  // this (its own builder handles it), but it doesn't hurt to keep it — it only
  // activates during `next build` outside Vercel's build pipeline.
  output: process.env.VERCEL ? undefined : "standalone",
  poweredByHeader: false,
  eslint: {
    dirs: ["app", "lib"],
  },
  experimental: {
    // Gallery uploads go through a Server Action; the default 1 MB body cap
    // would reject legitimate photos before lib/media.ts's 8 MB check runs.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    // Baseline security headers applied to every response. HSTS is set at the
    // edge/proxy layer (Vercel adds it automatically for custom domains).
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
