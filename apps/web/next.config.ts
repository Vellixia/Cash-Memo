import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  output: "standalone",
};

// No auth token configured (and none wanted here), so source maps are never uploaded — `disable: true`
// makes that explicit instead of relying on the plugin's no-token fallback.
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
});
