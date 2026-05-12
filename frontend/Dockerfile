# ============================================================
# Frontend Dockerfile - Ocean Viz Web UI
# ============================================================
# Two-stage build:
#   Stage 1 (builder): Node 20 + npm install + npm run build
#   Stage 2 (runtime): Nginx 仅 serve dist/ + 反代 /api → backend
# 最终镜像大小约 50 MB (vs 单阶段构建的 1.5 GB)

# ============================================================
# Stage 1: Build (临时编译环境, 编完即丢)
# ============================================================
FROM node:20-alpine AS builder

# 工作目录: 容器内的项目根
WORKDIR /build

# 先复制依赖清单 (利用 Docker 层缓存)
# Vite 项目根是 frontend/ocean-viz/
COPY ocean-viz/package*.json ./

# 装依赖 (npm ci 比 npm install 严格,只按 lock 文件装)
RUN npm ci

# 复制源码
COPY ocean-viz/ ./

# 构建时设 API 路径为 /api (相对路径, Nginx 会反代)
# 这个会被 Vite 编进 dist/, 浏览器访问时所有 fetch 都打 /api/...
# ENV VITE_API_BASE=/api
ENV VITE_API_BASE=


# 编译: 产物输出到 /build/dist/
RUN npm run build


# ============================================================
# Stage 2: Runtime (生产环境, 只装 Nginx)
# ============================================================
FROM nginx:1.27-alpine

# 复制编译产物 (从 Stage 1 的 /build/dist/ 复制到 Nginx 默认根目录)
COPY --from=builder /build/dist /usr/share/nginx/html

# 复制自定义 Nginx 配置 (替换默认 default.conf)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Nginx 默认监听 80 端口
EXPOSE 80

# 用默认 CMD (nginx -g 'daemon off;'), 不需要覆盖
