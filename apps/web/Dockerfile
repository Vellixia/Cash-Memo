# Build context: repo root (bun workspace + lockfile live there).
FROM oven/bun:1.4 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN bun install --frozen-lockfile --filter web
COPY apps/web apps/web
# Next inlines NEXT_PUBLIC_* at build time, so the GlitchTip DSN must be known here (it's public anyway:
# the browser sends to it). Empty = error reporting off.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
# The git tag (without the v), from the release workflow; shown in Settings and sent as the GlitchTip release.
ARG NEXT_PUBLIC_APP_VERSION="dev"
ENV NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
RUN cd apps/web && bun run build

FROM oven/bun:1.4
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=1001:1001 /app/apps/web/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=1001:1001 /app/apps/web/public ./apps/web/public
USER 1001
EXPOSE 3000
CMD ["bun", "apps/web/server.js"]
