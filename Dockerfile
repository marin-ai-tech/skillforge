FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/

RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    SKILLFORGE_HOST=0.0.0.0 \
    SKILLFORGE_DATA_DIR=/data

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY packages/web/package.json packages/web/

RUN npm ci --omit=dev --ignore-scripts \
 && mkdir -p /data \
 && chown -R node:node /data /app

COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist
COPY --from=build /app/packages/server/migrations ./packages/server/migrations
COPY --from=build /app/packages/server/starter-packs ./packages/server/starter-packs
COPY --from=build /app/plugins ./plugins
COPY --from=build /app/plugins/review-assistant ./packages/server/bundled-plugins/review-assistant
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/cli/package.json ./packages/cli/package.json

USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SKILLFORGE_PORT||8787)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "packages/server/dist/index.js"]
