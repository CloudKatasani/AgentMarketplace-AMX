import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  eslint: { dirs: ["src"] },
};

export default nextConfig;
