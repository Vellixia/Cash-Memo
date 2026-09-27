# Build context: repo root (Cargo workspace lives there).
FROM rust:1.98-slim-bookworm AS builder
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY crates crates
RUN cargo build --release -p worker

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/target/release/worker /usr/local/bin/worker
USER 10001
CMD ["worker"]
