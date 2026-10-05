ARG REGISTRY=docker.io/library
# Сборка фронтенда
FROM ${REGISTRY}/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Раздача статики + HTTPS (Caddy сам получает сертификат Let's Encrypt)
FROM ${REGISTRY}/caddy:2-alpine
COPY --from=build /app/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
