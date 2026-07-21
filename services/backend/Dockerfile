# syntax=docker/dockerfile:1.7

FROM node:22.12-alpine AS base

ENV NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

FROM base AS development

COPY . .

RUN npm ci

EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM base AS pruner

RUN npm install --global turbo@2.10.5

COPY . .

RUN turbo prune @professor-connect/api --docker

FROM base AS build

COPY --from=pruner /app/out/json/ ./

RUN npm ci

COPY --from=pruner /app/out/full/ ./
COPY --from=pruner /app/tsconfig.base.json ./tsconfig.base.json

RUN npx turbo run build --filter=@professor-connect/api...

FROM base AS production-dependencies

COPY --from=pruner /app/out/json/ ./

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM base AS production

LABEL org.opencontainers.image.title="Professor Connect Backend" \
      org.opencontainers.image.description="API HTTP e servidor Socket.IO do Professor Connect" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.vendor="Professor Connect"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --chown=node:node --from=build /app/packages/protocol/dist ./packages/protocol/dist
COPY --chown=node:node --from=build /app/services/backend/api/package.json ./services/backend/api/package.json
COPY --chown=node:node --from=build /app/services/backend/api/dist ./services/backend/api/dist
COPY --chown=node:node --from=build /app/services/backend/config/package.json ./services/backend/config/package.json
COPY --chown=node:node --from=build /app/services/backend/config/dist ./services/backend/config/dist
COPY --chown=node:node --from=build /app/services/backend/services/package.json ./services/backend/services/package.json
COPY --chown=node:node --from=build /app/services/backend/services/dist ./services/backend/services/dist
COPY --chown=node:node --from=build /app/services/backend/websocket/package.json ./services/backend/websocket/package.json
COPY --chown=node:node --from=build /app/services/backend/websocket/dist ./services/backend/websocket/dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT ?? '3000') + '/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

STOPSIGNAL SIGTERM

CMD ["node", "services/backend/api/dist/server.js"]
