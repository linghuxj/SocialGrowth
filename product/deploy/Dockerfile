# syntax=docker/dockerfile:1
ARG ARTEMIS_IMAGE=socialgrowth-artemis:351ca8422f7b5b54e80a9c1ce03a222e02415b6b
FROM node:24.16.0-bookworm-slim AS build
WORKDIR /build
RUN npm install --global pnpm@8.14.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY product/contracts product/contracts
COPY product/backend product/backend
COPY product/web product/web
COPY product/executor product/executor
COPY product/android/app/src/main/java/com/socialgrowth/product/ product/android/app/src/main/java/com/socialgrowth/product/
RUN pnpm install --frozen-lockfile --filter @socialgrowth/product-backend... --filter @socialgrowth/product-web... --filter @socialgrowth/product-executor...
RUN pnpm --filter @socialgrowth/product-contracts build && pnpm --filter @socialgrowth/product-backend build && pnpm --filter @socialgrowth/product-web build && pnpm --filter @socialgrowth/product-executor build
RUN pnpm --filter @socialgrowth/product-backend deploy --prod /out/backend
RUN pnpm --filter @socialgrowth/product-executor deploy --prod /out/executor

FROM node:24.16.0-bookworm-slim AS backend
ARG REVISION=unknown
LABEL org.opencontainers.image.revision=$REVISION
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/backend/ ./
COPY --chown=node:node product/deploy/migrate.mjs ./migrate.mjs
COPY --chown=node:node scripts/create-product-media-key-file.mjs ./create-media-keys.mjs
USER node
EXPOSE 4320
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD node -e "fetch('http://127.0.0.1:4320/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM caddy:2.10-alpine AS web
ARG REVISION=unknown
LABEL org.opencontainers.image.revision=$REVISION
COPY --from=build /build/product/web/dist/ /srv/
COPY product/deploy/Caddyfile /etc/caddy/Caddyfile

# Explicit full runtime targets; ordinary CI backend/web do not fetch Artemis.
FROM ${ARTEMIS_IMAGE} AS execution-base
COPY --from=build /usr/local/bin/node /usr/local/bin/node
RUN groupadd --gid 1000 node && useradd --uid 1000 --gid 1000 --create-home node && mkdir -p /var/lib/socialgrowth/artemis/traces /var/lib/socialgrowth/artemis/tmp && rm -rf /opt/artemis/traces /opt/artemis/tmp && ln -s /var/lib/socialgrowth/artemis/traces /opt/artemis/traces && ln -s /var/lib/socialgrowth/artemis/tmp /opt/artemis/tmp && chown -R node:node /var/lib/socialgrowth
ENV NODE_ENV=production SG_ARTEMIS_ROOT=/opt/artemis TRACES_PATH=/var/lib/socialgrowth/artemis/traces
COPY --chown=node:node scripts/artemis-business-model.py /scripts/artemis-business-model.py

FROM execution-base AS backend-artemis
ARG REVISION=unknown
LABEL org.opencontainers.image.revision=$REVISION
WORKDIR /app
COPY --from=build --chown=node:node /out/backend/ ./
COPY --chown=node:node product/deploy/migrate.mjs ./migrate.mjs
COPY --chown=node:node scripts/create-product-media-key-file.mjs ./create-media-keys.mjs
USER node
EXPOSE 4320
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 CMD node -e "fetch('http://127.0.0.1:4320/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM execution-base AS executor
ARG REVISION=unknown
LABEL org.opencontainers.image.revision=$REVISION
WORKDIR /app
COPY --from=build --chown=node:node /out/executor/ ./
USER node
EXPOSE 4318
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 CMD node -e "fetch('http://127.0.0.1:4318/api/runtime/health',{headers:{Authorization:'Bearer '+process.env.SG_RUNTIME_TOKEN}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
