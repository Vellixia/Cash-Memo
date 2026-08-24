FROM node:24.14.0-bookworm-slim AS dependencies

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.13.1 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @cashmemo/v1-web...

FROM dependencies AS builder

ENV NEXT_TELEMETRY_DISABLED=1
COPY apps/web ./apps/web
RUN pnpm --dir apps/web build

FROM node:24.14.0-bookworm-slim AS runtime

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
WORKDIR /app
COPY --from=builder --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /src/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "apps/web/server.js"]
