FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
# 使用国内 npm 镜像，避免容器内构建时下载缓慢。
RUN npm config set registry https://registry.npmmirror.com && npm ci --no-audit --no-fund
COPY . .

# 容器内走 nginx 反代，API 用相对路径。
RUN VITE_API_BASE_URL=/v1 npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
