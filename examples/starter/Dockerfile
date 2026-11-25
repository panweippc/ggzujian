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
COPY packages ./packages
COPY server ./server
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=web-build /app/web/dist ./web/dist
WORKDIR /app/server
EXPOSE 3011
CMD ["node", "server.js"]
