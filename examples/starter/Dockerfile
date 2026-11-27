# 多阶段构建：前端构建 + 后端运行
FROM node:20-alpine AS web-build
WORKDIR /app/web
COPY web/package.json ./
COPY packages/admin-ui ./packages/admin-ui
COPY web/ ./
RUN npm install --no-audit --no-fund && npm run build

FROM node:20-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json ./
COPY packages/auth-kit ./packages/auth-kit
RUN npm install --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Shanghai
# 安全加固：以非 root 用户运行；运行时目录（上传/日志）预先授权
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /app/server/uploads /app/server/logs /app/web/dist \
    && chown -R appuser:appgroup /app
COPY --chown=appuser:appgroup packages ./packages
COPY --chown=appuser:appgroup server ./server
COPY --chown=appuser:appgroup --from=server-deps /app/server/node_modules ./server/node_modules
COPY --chown=appuser:appgroup --from=web-build /app/web/dist ./web/dist
WORKDIR /app/server
USER appuser
EXPOSE 3011
CMD ["node", "server.js"]
