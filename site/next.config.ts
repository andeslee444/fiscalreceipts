import type { NextConfig } from "next";
import path from "path";

// When next.config.ts is compiled by Next's SWC bundler it runs from the
// project directory, so process.cwd() resolves to site/.  We pin both
// outputFileTracingRoot and turbopack.root here so the parent
// package-lock.json (one level up) is visible to the bundler.
const siteRoot = path.resolve(process.cwd());

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: siteRoot,
  turbopack: {
    root: siteRoot,
  },
};

export default nextConfig;
