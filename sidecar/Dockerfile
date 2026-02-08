# =============================================================================
# Open-Dispatch Sidecar Image
#
# Minimal image containing the webhook relay scripts that Sprites use to
# communicate back to Open-Dispatch. Users install these into their own
# agent images via multi-stage COPY:
#
#   FROM ghcr.io/bobum/open-dispatch/sidecar:latest AS sidecar
#   FROM your-base-image
#   COPY --from=sidecar /sidecar/ /usr/local/bin/
#
# Contents:
#   /sidecar/sprite-reporter    — Bash entry point (clone, run, report)
#   /sidecar/output-relay.js    — Node.js buffered output relay
#   /sidecar/formatters/        — Optional output formatters (set OUTPUT_FORMATTER)
# =============================================================================

FROM node:22-slim

# Install minimal dependencies for sprite-reporter.sh
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    jq \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy sidecar scripts to a well-known path
COPY sprite-reporter.sh /sidecar/sprite-reporter
COPY output-relay.js /sidecar/output-relay.js
COPY formatters/ /sidecar/formatters/

RUN chmod +x /sidecar/sprite-reporter

# Default: run the reporter (users override CMD in their images)
ENTRYPOINT ["/sidecar/sprite-reporter"]
