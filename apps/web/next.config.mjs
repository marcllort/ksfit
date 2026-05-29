import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
  // Monorepo: trace from the workspace root so the standalone bundle includes
  // the @stride/* workspace packages the web app imports.
  outputFileTracingRoot: join(__dirname, "../../"),
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fds.api.xiaomi.com" },
      { protocol: "https", hostname: "**.mi-img.com" },
      { protocol: "https", hostname: "static.kingsmith.com.cn" },
      { protocol: "https", hostname: "cdn.cnbj2.fds.api.mi-img.com" },
    ],
  },
};
export default config;
