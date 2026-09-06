# backend-server

backend-server 是本项目的 Node.js 业务中台，负责承接前端请求、管理 SQLite/Prisma 元数据、处理文件上传与分片上传、编排 AI-server 入库回调，以及维护聊天会话与消息记录。

## 技术栈

- Express 5
- Prisma
- SQLite
- Multer
- Zod
- TypeScript

## 目录结构

```text
backend-server/
├─ src/
│  ├─ app.ts
│  ├─ server.ts
│  ├─ controllers/
│  ├─ middleware/
│  ├─ repositories/
│  ├─ routes/
│  └─ services/
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/
├─ docs/
├─ upload/
├─ .env.example
└─ package.json
```

## 核心职责

- 管理用户、知识库文件、入库任务、chunk 元数据
- 提供文件预检、直传、分片上传、状态查询、入库派发、出库、删除接口
- 提供聊天会话、消息、流式 completion 入口
- 与 AI-server 通过 HTTP 协作完成向量化与聊天生成

## 主要接口前缀

- `/health`
- `/v1/auth/**`
- `/v1/files/**`
- `/v1/tasks/**`
- `/v1/chat/**`
- `/v1/ai/**`（仅 AI-server 回调）

完整接口说明见 [docs/api-spec.md](docs/api-spec.md)。

## 环境变量

建议先复制 `.env.example` 为 `.env`，再按本地环境调整：

```env
DATABASE_URL="file:./dev.db"
PORT=3001
AI_SERVICE_BASE_URL=http://127.0.0.1:8000
AI_SERVICE_SHARED_SECRET=
UPLOAD_MAX_FILE_SIZE_MB=20
AI_SERVICE_TIMEOUT_MS=12000
AI_INGESTION_ENDPOINT=
AI_VECTOR_DELETE_ENDPOINT=
AUTH_SESSION_TTL_HOURS=72
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
CHAT_CONTEXT_MESSAGE_LIMIT=12
```

说明：

- `DATABASE_URL`: Prisma/SQLite 连接串
- `PORT`: Node 服务端口，默认 `3001`
- `AI_SERVICE_BASE_URL`: Python AI 服务地址
- `AI_SERVICE_SHARED_SECRET`: 与 AI-server 的共享密钥
- `UPLOAD_MAX_FILE_SIZE_MB`: 单文件上传大小上限
- `AI_SERVICE_TIMEOUT_MS`: 调用 AI-server 超时时间
- `AUTH_SESSION_TTL_HOURS`: 登录会话有效期（小时），默认 `72`
- `CORS_ORIGINS`: 允许跨域的前端地址（逗号分隔），默认 `http://localhost:5173,http://127.0.0.1:5173`
- `CHAT_CONTEXT_MESSAGE_LIMIT`: 发送给 AI 的历史消息条数，默认 `12`（与 AI-server 保持一致）
- `INGESTION_STALE_TIMEOUT_MINUTES`: 入库任务超过该分钟数无进展即自动置为 failed 可重试（启动时还会清扫上次运行遗留的进行中任务），默认 `10`
- 用户模型配置：`/v1/model-config`（每个账号可在前端自定义聊天/向量模型；API Key 仅存服务端并脱敏展示，只能覆盖不能查看）

## 安装与初始化

```bash
cd backend-server
npm install
npm run prisma:generate
npm run prisma:migrate
```

如果只希望把当前 schema 推到本地数据库，也可以使用：

```bash
npm run prisma:push
```

## 启动方式

开发模式：

```bash
cd backend-server
npm run dev
```

直接启动：

```bash
cd backend-server
npm run start
```

构建检查：

```bash
cd backend-server
npm run build
```

默认服务地址：`http://127.0.0.1:3001`

## 与其他服务的关系

- client 通过 `http://localhost:3001/v1` 调用本服务
- 本服务负责保存聊天会话、文件元数据、chunk 元数据
- 本服务把知识库入库任务和聊天请求转发给 AI-server
- AI-server 完成任务后再回调本服务，更新状态和 chunk 信息

## 安全特性

- 用户 API Key 在数据库中加密存储（AES-256-GCM）。主密钥来自环境变量 `MODEL_KEY_ENCRYPTION_KEY`（≥16 字符）；
  未设置时首次使用会自动生成 `backend-server/.model-key` 密钥文件（已 gitignore，勿删，否则已存 Key 无法解密）。
- 登录失败锁定：同一用户名连续失败 5 次锁定 15 分钟（内存实现，进程重启清零）。
- 上传校验：扩展名白名单（PDF/DOCX/TXT/MD/HTML/XLSX）+ 二进制格式魔数校验（PDF `%PDF`、OOXML `PK`）。
- 删除已入库文件需要 AI-server 可用（要先清理向量，防止孤儿向量污染检索）；AI 离线时删除返回 502。

## 测试

```bash
cd backend-server
npm test
```

集成测试（node:test + tsx）覆盖：注册/登录/会话/登录锁定、上传→派发失败→AI 回调→分块同步→属主隔离→级联删除、
模型配置的脱敏回显/覆盖语义/加密往返/参数校验。每个测试文件使用独立的 `prisma/test-*.db`，并行运行互不干扰，结束后自动清理。

## Docker 部署

```bash
# 先准备好 backend-server/.env 与 AI-server/.env（模型凭据必填）
docker compose up -d --build
# 访问 http://localhost:8080
```

- 三服务编排见根目录 `compose.yml`；前端由 nginx 托管并反代 `/v1`（已关闭缓冲以支持 SSE）。
- 数据持久化：SQLite（backend-db 卷）、上传文件（backend-upload 卷）、Chroma（ai-chroma 卷）。

## 补充文档

- [docs/api-spec.md](docs/api-spec.md)
- [docs/node-service-functional-guide.md](docs/node-service-functional-guide.md)
- [prisma/schema-design.md](prisma/schema-design.md)
