FROM node:22.12-alpine AS development

WORKDIR /app

COPY . .

RUN npm ci

EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM development AS build

RUN npm run build

FROM node:22.12-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/api/package.json ./backend/api/package.json
COPY --from=build /app/backend/api/dist ./backend/api/dist
COPY --from=build /app/backend/config/package.json ./backend/config/package.json
COPY --from=build /app/backend/config/dist ./backend/config/dist
COPY --from=build /app/backend/websocket/package.json ./backend/websocket/package.json
COPY --from=build /app/backend/websocket/dist ./backend/websocket/dist

EXPOSE 3000

CMD ["npm", "run", "start"]
