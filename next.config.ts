import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a native module — exclude from webpack bundling so Node.js loads it natively
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
