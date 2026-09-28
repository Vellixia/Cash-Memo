# Build context: repo root (Cargo workspace lives there).
FROM rust:1.98-slim-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY crates crates
# The git tag (without the v), from the release workflow; shows in /api/health and GlitchTip.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
RUN cargo build --release -p api

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/api /usr/local/bin/api
USER 10001
ENV PORT=8080
EXPOSE 8080
CMD ["api"]
