# syntax=docker/dockerfile:1
FROM node:24.16.0-bookworm-slim AS build
WORKDIR /build
RUN npm install --global pnpm@8.14.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY product/contracts product/contracts
COPY product/backend product/backend
COPY product/web product/web
COPY product/android/app/src/main/java/com/socialgrowth/product/ product/android/app/src/main/java/com/socialgrowth/product/
RUN pnpm install --frozen-lockfile --filter @socialgrowth/product-backend... --filter @socialgrowth/product-web...
RUN pnpm --filter @socialgrowth/product-contracts build && pnpm --filter @socialgrowth/product-backend build && pnpm --filter @socialgrowth/product-web build
RUN pnpm --filter @socialgrowth/product-backend deploy --prod /out/backend

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
