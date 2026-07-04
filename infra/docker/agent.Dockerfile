# syntax=docker/dockerfile:1.7
# =============================================================================
# YourStack node agent (Rust) — OPTIONAL dev image (compose profile: nodes).
#
# The agent normally runs on a user's own server as a signed binary, NOT in the
# control-plane stack. This image exists so contributors can exercise the full
# register -> heartbeat -> poll -> execute loop against the local compose stack.
#
# Build context = repo root; the crate lives at apps/agent.
# =============================================================================

ARG RUST_VERSION=1.83

FROM rust:${RUST_VERSION}-slim AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Cache dependencies first.
COPY apps/agent/Cargo.toml apps/agent/Cargo.lock* ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs \
 && cargo build --release || true
# Real sources.
COPY apps/agent/ ./
RUN cargo build --release --locked || cargo build --release

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/release/yourstack-agent /usr/local/bin/yourstack-agent
ENV RUST_LOG=info
# reqwest uses rustls (no OpenSSL runtime dependency needed).
ENTRYPOINT ["/usr/local/bin/yourstack-agent"]
CMD ["run"]
