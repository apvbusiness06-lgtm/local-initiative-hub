/** @type {import('next').NextConfig} */
const nextConfig = {
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
};

module.exports = nextConfig;
