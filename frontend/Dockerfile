# Two-stage build:
#   Stage 1 (builder): Node 20 + npm install + npm run build
#   Stage 2 (runtime): Nginx 仅 serve dist/ + 反代 /api → backend

FROM node:20-alpine AS builder


WORKDIR /build


COPY ocean-viz/package*.json ./


RUN npm ci


COPY ocean-viz/ ./


ENV VITE_API_BASE=



RUN npm run build



FROM nginx:1.27-alpine


COPY --from=builder /build/dist /usr/share/nginx/html


COPY nginx.conf /etc/nginx/conf.d/default.conf


EXPOSE 80


