# RAGBox

[![CI](https://github.com/wwwwjjjjjaaaaa1111/RAGBox/actions/workflows/ci.yml/badge.svg)](https://github.com/wwwwjjjjjaaaaa1111/RAGBox/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Frontend: React](https://img.shields.io/badge/Frontend-React%2018-61dafb.svg)
![Backend: Express](https://img.shields.io/badge/Backend-Express%205-000000.svg)
![AI Server: FastAPI](https://img.shields.io/badge/AI%20Server-FastAPI-009688.svg)

RAGBox 是一个本地可运行的知识库 RAG 问答应用，由三个服务组成：**client** 提供 React 前端界面；**backend-server**(Express + Prisma)负责账号、文件与对话的业务编排；**AI-server**(FastAPI + LangChain + Qdrant)负责文档解析、向量化与检索增强生成。支持文档上传入库、带引用来源的流式问答、基于检索数据的聊天内图表生成(内嵌预览与 PDF 下载)、逐账号自定义模型接入，以及完整的账号体系。

此外还提供 **mcp-server**：把知识库与对话能力以 MCP 协议暴露给 Claude Desktop / ZCode / Cursor，可在 AI 客户端里直接检索知识库、生成图表，并与网页端共享同一份会话记录。

## 快速开始

1. 安装 `client`、`backend-server`、`AI-server` 三部分依赖（如需 MCP 接入，再加装 `mcp-server`）
2. 复制各自的 `.env.example` 为 `.env` 并填写必填配置（聊天与向量模型凭据）
3. 启动 `backend-server`
4. 启动 `AI-server`
5. 启动 `client`

默认访问地址：

- 前端：`http://127.0.0.1:5173`
- backend-server：`http://127.0.0.1:3001`
- AI-server：`http://127.0.0.1:8000`

## 项目简介

这个项目面向本地知识库问答场景，目标是把“文件上传 -> 入库向量化 -> 检索增强问答 -> 会话管理”这一整条链路串起来，方便你直接在本地开发、联调和扩展。

当前已经具备以下核心能力：

- 知识库文件上传，支持普通上传和分片上传
- 文件入库、出库、删除与状态跟踪
- 文件向量分块详情查看
- 基于知识库的流式 AI 对话
- 账号注册/登录，每个账号可在“模型设置”页自定义聊天与向量模型（API Key 脱敏存储，仅可覆盖）
- 对话可限定检索范围（只检索选定的知识库文件）
- 会话标题自动生成；支持多轮指代问题的检索改写
- 引用来源可点击查看原文片段
- 聊天中可直接要求“画个柱状图/折线图”，AI 自动从文档提取数据，图表内嵌展示；图表随消息持久化，历史会话同样回显，并提供含数据核对页的 PDF 下载
- 聊天会话创建、切换与删除
- 可作为 MCP 服务接入 Claude Desktop / ZCode / Cursor：在 AI 编辑器里直接检索知识库、生成图表，并与网页共享同一份会话记录
- 前后端与 AI 服务分层清晰，便于二次开发


## 项目结构

```text
RAGBox/
├─ client/          # React + Vite 前端
├─ backend-server/  # Node.js + Prisma 业务服务
├─ AI-server/       # FastAPI + LangChain AI 服务
├─ mcp-server/      # MCP 服务：把知识库与对话能力暴露给 AI 客户端
├─ compose.yml      # Docker Compose 编排
├─ start-all.bat    # Windows 一键启动
└─ start-all.sh     # Git Bash / Linux / macOS 一键启动
```

MCP 服务的安装与客户端配置见 [mcp-server/README.md](mcp-server/README.md)。

## 系统架构

### client

- 提供聊天与知识库管理 UI
- 调用 backend-server 的 REST/SSE 接口

### backend-server

- 管理用户、文件、任务、聊天会话、消息、chunk 元数据
- 负责文件上传、分片上传、入库派发、聊天代理
- 与 AI-server 协作执行真正的向量化与聊天生成

### AI-server

- 负责文档解析、切块、Embedding、Qdrant 向量写入
- 负责基于知识库召回结果的聊天流式生成

## 核心业务流程

### 知识库流程

1. 用户在前端上传文件
2. backend-server 完成文件元数据落库和上传处理
3. backend-server 派发入库任务到 AI-server
4. AI-server 解析文件、切块、向量化并写入 Qdrant
5. AI-server 回调 backend-server 更新任务状态与 chunk 元数据
6. 前端通过事件流和轮询刷新知识库状态

### 聊天流程

1. 用户在 Chat 页面发起问题
2. backend-server 创建用户消息并向 AI-server 发起流式聊天请求
3. AI-server 检索知识库相关片段并构造 Prompt
4. 聊天模型以 SSE 方式逐段返回回答内容
5. backend-server 持久化 assistant 消息并转发事件给前端
6. 前端按增量事件实时更新聊天窗口

### MCP 接入流程（可选）

1. 在网页 **模型设置 → 外部接入（MCP）** 生成个人访问令牌，按需勾选权限
2. 客户端（Claude Desktop / ZCode / Cursor）以 stdio 方式拉起 `mcp-server`，通过环境变量传入令牌
3. 客户端调用工具时，请求带上令牌访问 backend-server；令牌只能做其 scope 允许的事
4. `ask_in_session` 复用网页同款的对话接口，因此问答会正常落库
5. backend-server 通过会话事件流通知网页，网页无需手动刷新即可看到 MCP 侧写入的消息

> **注意两条路径的区别**：`search_knowledge_base` 只做检索、把原文交给当前模型，**不留任何记录**，
> 网页端看不到；只有 `ask_in_session` 会把问答存进会话。若发现「在 AI 客户端里问完、网页上没有」，
> 通常就是走了只读检索。详见 [mcp-server/README.md](mcp-server/README.md)。

## 推荐启动顺序

1. 启动 `backend-server`
2. 启动 `AI-server`
3. 启动 `client`

## Docker 部署（可选）

准备好 `backend-server/.env` 与 `AI-server/.env` 后，在项目根目录执行：

```bash
docker compose up -d --build
```

访问 `http://localhost:8080`（端口可用 `CLIENT_PORT` 环境变量调整）。详见 [backend-server/README.md](backend-server/README.md)。

## 一键启动

项目根目录提供了启动脚本，会自动完成 `.env` 生成、依赖检查/安装、数据库初始化，并同时启动三个服务：

**Windows（推荐）：** 双击 `start-all.bat`，或双击 `stop-all.bat` 一键停止全部服务。

**Git Bash / Linux / macOS：**

```bash
# 先激活 AI-server 的 Python 环境（首次会自动安装其依赖）
conda activate LCenv
bash start-all.sh
```

脚本行为说明：

- 若某子项目缺少 `.env`，会自动从 `.env.example` 复制一份；**AI 功能的 API Key 仍需在 `AI-server/.env` 中手动填写**。
- 若缺少 `node_modules` 会自动执行 `npm install`；若缺少数据库文件会自动应用 Prisma 迁移。
- `start-all.bat` 会优先查找名为 `LCenv` 的 conda 环境（可通过环境变量 `AI_SERVER_PYTHON` 指定 Python 路径）。
- Git Bash 脚本日志写入 `.logs/` 目录，按 `Ctrl+C` 停止全部服务。

## 运行前准备

### 1. 进入项目根目录

```bash
cd AI-chat-rag
```

### 2. 安装 client 依赖

```bash
cd client
npm install
cd ..
```

### 3. 安装 backend-server 依赖

```bash
cd backend-server
npm install
npm run prisma:generate
npm run prisma:migrate
cd ..
```

### 4. 安装 AI-server 依赖

```powershell
cd AI-server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cd ..
```

> 图表生成功能依赖 matplotlib（已包含在 requirements.txt 中）；容器部署时镜像会自动安装中文字体（Noto Sans CJK）。

## 环境变量

建议分别复制下面 3 个示例文件后再填写：

- `backend-server/.env.example` -> `backend-server/.env`
- `AI-server/.env.example` -> `AI-server/.env`
- `client/.env.example` -> `client/.env`

### backend-server

参考 [backend-server/README.md](backend-server/README.md)。

必填：

```env
DATABASE_URL="file:./dev.db"
```

可选且有默认值：`PORT`、`UPLOAD_MAX_FILE_SIZE_MB`、`AI_SERVICE_TIMEOUT_MS`、`AUTH_SESSION_TTL_HOURS`、`CHAT_CONTEXT_MESSAGE_LIMIT`

按部署情况可选：`AI_SERVICE_BASE_URL`、`AI_SERVICE_SHARED_SECRET`、`AI_INGESTION_ENDPOINT`、`AI_VECTOR_DELETE_ENDPOINT`

### AI-server

参考 [AI-server/README.md](AI-server/README.md)。不是所有配置都必须填写，取决于你启用了哪些功能。

知识库入库功能必填：

```env
ZHIPUAI_API_KEY=
```

聊天功能必填：

```env
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=
```

可选且有默认值：

```env
NODE_BASE_URL=http://127.0.0.1:3001/v1
CHROMA_PERSIST_DIRECTORY=
CHROMA_COLLECTION_NAME=knowledge_chunks
INGEST_CHUNK_SIZE=800
INGEST_CHUNK_OVERLAP=120
EMBEDDING_BATCH_SIZE=64
NODE_CALLBACK_TIMEOUT_SECONDS=10
CHAT_RETRIEVAL_TOP_K=5
CHAT_CONTEXT_MESSAGE_LIMIT=12
HOST=127.0.0.1
PORT=8000
```

按部署情况可选：

```env
AI_SERVICE_SHARED_SECRET=
OPENAI_BASE_URL=
```

如果你只验证知识库入库，不跑聊天，可以先不填 `OPENAI_API_KEY` 和 `OPENAI_CHAT_MODEL`。

如果你只验证聊天，不跑新的向量入库，可以先不填 `ZHIPUAI_API_KEY`。

### client

参考 [client/README.md](client/README.md)。前端配置全部可选，未填写时使用默认值。

```env
VITE_API_BASE_URL=http://localhost:3001/v1
VITE_UPLOAD_CHUNK_SIZE_BYTES=4194304
VITE_UPLOAD_CHUNK_CONCURRENCY=4
VITE_UPLOAD_CHUNK_RETRY_LIMIT=3
VITE_UPLOAD_SMALL_FILE_THRESHOLD_BYTES=20971520
```

## 启动步骤

### 启动 backend-server

```bash
cd backend-server
npm run dev
```

默认地址：`http://127.0.0.1:3001`

### 启动 AI-server

```powershell
cd AI-server
.\.venv\Scripts\Activate.ps1
python main.py
```

默认地址：`http://127.0.0.1:8000`

### 启动 client

```bash
cd client
npm run dev
```

默认地址通常为：`http://127.0.0.1:5173`

## 常用访问入口

- 前端首页：`http://127.0.0.1:5173`
- backend 健康检查：`http://127.0.0.1:3001/health`
- AI-server 健康检查：`http://127.0.0.1:8000/health`

## 开发建议

- 先确保 backend-server 与 AI-server 都能通过健康检查
- 知识库上传链路异常时，优先检查两侧共享密钥与回调地址
- 聊天无回答时，优先检查 AI-server 的模型配置与知识库是否已完成向量化

## License

本项目采用 [MIT License](LICENSE)。

## 子项目文档

- [client/README.md](client/README.md)
- [backend-server/README.md](backend-server/README.md)
- [AI-server/README.md](AI-server/README.md)
