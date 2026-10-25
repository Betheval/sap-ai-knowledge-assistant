# syntax=docker/dockerfile:1
# Production image of the SAP AI Knowledge Assistant (ADR 0018).
#   docker build -t knowledge-assistant .
#   docker run -p 4004:4004 --env-file docker.env knowledge-assistant   (see README)

ARG NODE_VERSION=22

# --- build: compile TypeScript, build the UI, check that no credentials leaked
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src

COPY package.json package-lock.json ./
COPY app/assistant/package.json app/assistant/
# Scripts run later, once the sources they need (CDS model) are in place
RUN npm ci --ignore-scripts

COPY . .
RUN npm run typer \
 && npx cds build --production \
 && npm run build --workspace app/assistant \
 && npx tsx scripts/check-build-secrets.ts

# --- runtime: production dependencies and build output only
FROM node:${NODE_VERSION}-bookworm-slim
ENV NODE_ENV=production \
    PORT=4004 \
    NO_TELEMETRY=true
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --workspaces=false \
 && npm cache clean --force

COPY --from=build /src/gen/srv/ ./
# CAP serves app/ statically: the UI is available at /assistant/
COPY --from=build /src/app/assistant/dist/ ./app/assistant/

USER node
EXPOSE 4004
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4004/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node_modules/.bin/cds-serve"]
