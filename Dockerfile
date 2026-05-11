FROM node:20-alpine

# su-exec lets the entrypoint chown the mounted volume as root, then
# exec the server as the unprivileged `node` user.
RUN apk add --no-cache su-exec

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node server.js ceda-workshop.html ./
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# RECAP_DIR points inside the Fly volume mount declared in fly.toml.
ENV NODE_ENV=production
ENV PORT=3000
ENV RECAP_DIR=/data/recaps

EXPOSE 3000

# Local-only safety net — Fly uses [[http_service.checks]] from fly.toml.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
