# Codex (OpenAI) - lightweight coding agent
# https://github.com/openai/codex | https://developers.openai.com/codex
FROM node:24-slim

ARG TZ=UTC
ENV TZ="$TZ"

# Dev tools for Codex (git, ripgrep, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    ripgrep \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install Codex globally
ENV NPM_CONFIG_PREFIX=/usr/local
RUN npm install -g @openai/codex \
    && npm cache clean --force

# Required for running in container (no sandbox)
ENV CODEX_UNSAFE_ALLOW_NO_SANDBOX=1

WORKDIR /workspace

# Default: keep container running for exec from agent-runner
# Codex CLI: codex exec "task" for non-interactive
CMD ["codex", "--help"]
