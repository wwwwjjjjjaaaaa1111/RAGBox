FROM node:22-alpine

WORKDIR /app

# 先装依赖以利用层缓存；prisma generate 需要 devDependencies 中的 prisma CLI。
COPY package.json package-lock.json ./
# 使用国内 npm 镜像，避免容器内构建时下载缓慢。
RUN npm config set registry https://registry.npmmirror.com && npm ci --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

EXPOSE 3001

# 启动前先应用数据库迁移（幂等）。
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/server.ts"]
