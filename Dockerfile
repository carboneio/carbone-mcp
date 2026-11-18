FROM node:26-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# The vendored Carbone Skill, with modes reset so the build host's umask doesn't matter.
COPY skills/ ./skills/
RUN chmod -R u=rwX,go=rX skills

# ─── Runtime ──────────────────────────────────────────────────────────────────

FROM node:26-alpine

WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

# Where MCP_JOBS_DIR can point: a volume mounted here starts owned by node, so the server can write to it.
RUN mkdir -p /data/jobs && chown node:node /data/jobs

# Owned by root: the node user can read the code and the skill, not change them.
COPY --from=builder /app/skills ./skills
COPY --from=builder /app/dist ./dist

LABEL io.modelcontextprotocol.server.name="io.carbone/carbone-mcp"

ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_PORT=3000
ENV MCP_PATH=/

USER node

EXPOSE 3000

ENTRYPOINT ["node", "dist/index.js"]
