/** @type {import('next').NextConfig} */
const config = {
  output: "standalone",
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
