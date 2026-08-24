import type { NextConfig } from "next";

const noStoreHeaders = [
  { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  headers() {
    return Promise.resolve([
      { source: "/app/:path*", headers: noStoreHeaders },
      { source: "/deletion/:path*", headers: noStoreHeaders },
      { source: "/api/v1/:path*", headers: noStoreHeaders },
    ]);
  },
};

export default nextConfig;
