import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/node-API packages must not be bundled — loaded from node_modules at runtime.
  serverExternalPackages: ["@lancedb/lancedb", "pdfjs-dist"],
};

export default nextConfig;
