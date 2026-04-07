FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

RUN apk add --no-cache iproute2

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/99-set-api-gateway.sh /docker-entrypoint.d/99-set-api-gateway.sh
RUN chmod +x /docker-entrypoint.d/99-set-api-gateway.sh

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
