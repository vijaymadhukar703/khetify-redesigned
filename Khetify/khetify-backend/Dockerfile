# Khetify backend
FROM node:20-alpine
WORKDIR /app

# NEW_RELIC_LOG: the agent would otherwise write newrelic_agent.log into /app
# (read-only for the app user); stdout also lands in container logs/CloudWatch.
ENV NODE_ENV=production NEW_RELIC_LOG=stdout

# Install deps first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Run as the unprivileged "node" user. Code stays root-owned (read-only for the
# app); only the local uploads directory is writable. In production mount a host
# directory there until every upload path uses S3 (see docs/AWS-DEPLOYMENT.md).
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads
USER node

EXPOSE 5000

# Basic container healthcheck against /healthz (honours PORT when overridden).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-5000}/healthz" || exit 1

# Node is PID 1 and handles SIGTERM itself (graceful shutdown in Server.js).
CMD ["node", "Server.js"]
