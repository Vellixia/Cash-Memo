import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  output: "standalone",
  // Categories and sources moved under /manage; keep old links and bookmarks working.
  redirects: async () => [
    { source: "/categories", destination: "/manage?tab=categories", permanent: false },
    { source: "/sources", destination: "/manage?tab=sources", permanent: false },
  ],
};

// No auth token configured (and none wanted here), so source maps are never uploaded — `disable: true`
// makes that explicit instead of relying on the plugin's no-token fallback.
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
});
