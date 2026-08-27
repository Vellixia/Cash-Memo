FROM node@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS dependencies

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

FROM node@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 AS runtime

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
WORKDIR /app
COPY --from=builder --chown=node:node /src/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /src/apps/web/public ./apps/web/public

# Apply only fixed versions identified by the pinned-base Trivy scan.
# Standalone Next.js needs node only, so remove only verified package-manager
# trees and their verified entrypoints from the official Node image.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends --only-upgrade \
         libcap2=1:2.66-4+deb12u3+b1 \
         libgnutls30=3.7.9-2+deb12u7 \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm \
             /usr/local/bin/npx \
             /usr/local/bin/corepack

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "apps/web/server.js"]
