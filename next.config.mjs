import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {turbopackFileSystemCacheForDev: process.env.VENTRA_DISABLE_DEV_CACHE !== "1"},
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
