import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a native module — exclude from webpack bundling so Node.js loads it natively
  serverExternalPackages: ["sharp", "ffmpeg-static"],
  // The reels tick shells out to the ffmpeg binary and burns subtitles with a
  // bundled font — both must survive serverless output file tracing.
  outputFileTracingIncludes: {
    "/api/reels/tick": ["./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
