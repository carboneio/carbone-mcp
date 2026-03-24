FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:24-alpine

WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV MCP_PORT=3000
ENV MCP_PATH=/

USER node

EXPOSE 3000

ENTRYPOINT ["node", "dist/index.js"]
