/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output bundles a minimal server + only the needed node_modules
  // into .next/standalone, which the Dockerfile copies for a small runtime image.
  output: "standalone",
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
    // edge/proxy (it needs the request to already be HTTPS) — see deploy/nginx.
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
