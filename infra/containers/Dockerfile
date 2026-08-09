# syntax=docker/dockerfile:1.12

ARG NODE_IMAGE=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

FROM ${NODE_IMAGE} AS runtime-base

ARG PNPM_VERSION=11.13.1
ENV COREPACK_HOME=/opt/corepack \
    PNPM_HOME=/opt/pnpm \
    PATH=/opt/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && install -d -o node -g node \
      /workspace \
      /var/lib/cashmemo/audio \
      /var/lib/cashmemo/work

WORKDIR /workspace

LABEL org.opencontainers.image.title="Cashmemo modular monolith" \
      org.opencontainers.image.description="Pinned non-root Cashmemo runtime baseline" \
      dev.cashmemo.runtime.root-filesystem="read-only-required"

FROM runtime-base AS development

ENV NODE_ENV=development

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .

USER node
VOLUME ["/tmp", "/var/lib/cashmemo/audio", "/var/lib/cashmemo/work"]
CMD ["pnpm", "dev"]

FROM runtime-base AS production

ENV NODE_ENV=production

# T231 replaces this baseline copy with build-once artifacts and production-only
# dependencies. This target intentionally establishes the immutable runtime contract.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./

USER node
VOLUME ["/tmp", "/var/lib/cashmemo/audio", "/var/lib/cashmemo/work"]
CMD ["node", "apps/server/dist/main.js"]
