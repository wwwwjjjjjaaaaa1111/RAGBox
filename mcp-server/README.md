# RAGBox MCP 服务

让 Claude Desktop、ZCode、Cursor 等支持 MCP 的客户端直接检索 RAGBox 知识库、生成图表，
并与网页端**共享同一份会话记录** —— 在 agent 里问过的问题，网页上打开同一会话就能看到。

## 工作原理

```
Claude Desktop / ZCode / Cursor
        │ stdio (MCP 协议)
        ▼
   mcp-server (本包，Node)
        │ HTTP + Bearer 个人访问令牌
        ▼
  backend-server :3001 ──► AI-server :8000 ──► Chroma 向量库
        ▲
        │ 同一份数据库
   client (网页)
```

本服务是 backend-server 的一个普通消费者，不直接读写向量库 —— 避免多进程竞争 Chroma。

## 前置条件

1. `backend-server` 与 `AI-server` 已启动（MCP 服务本身不提供服务端能力）
2. 在网页 **模型设置 → 外部接入（MCP）** 生成一枚个人访问令牌（形如 `ragbox_pat_...`）
3. 构建本包：`cd mcp-server && npm install && npm run build`

令牌等同于你的身份，请勿提交到仓库；长期不用时可在网页随时吊销。

## 权限（scope）

生成令牌时按需勾选，令牌默认只给最小权限：

| scope | 允许的操作 |
|---|---|
| `kb:read` | 检索知识库、列出文件、读取文件分块 |
| `chat:write` | 读取会话历史、提问并写入新消息 |
| `charts:generate` | 按给定数据生成图表 |

网页登录的会话不受 scope 限制；令牌管理接口只允许网页会话调用（防止令牌自我提权）。

## 客户端配置

两种客户端都使用同一套 stdio 启动方式，只是配置文件位置不同。把路径换成本机的绝对路径。

### Claude Desktop

编辑 `%APPDATA%\Claude\claude_desktop_config.json`（macOS：`~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "ragbox": {
      "command": "node",
      "args": ["E:/1/AI-chat-rag-main/mcp-server/dist/index.js"],
      "env": {
        "RAGBOX_API_URL": "http://127.0.0.1:3001/v1",
        "RAGBOX_TOKEN": "ragbox_pat_在这里粘贴你的令牌"
      }
    }
  }
}
```

### ZCode / Cursor

在客户端的 MCP 配置（如 `mcp.json`）中新增：

```json
{
  "mcpServers": {
    "ragbox": {
      "command": "node",
      "args": ["E:/1/AI-chat-rag-main/mcp-server/dist/index.js"],
      "env": {
        "RAGBOX_API_URL": "http://127.0.0.1:3001/v1",
        "RAGBOX_TOKEN": "ragbox_pat_在这里粘贴你的令牌"
      }
    }
  }
}
```

配置完成后重启客户端。若客户端显示连接失败，先让它调用 `ragbox_status` —— 它会报告后端地址、
令牌状态与真实连接结果，比客户端自己的报错更具体。

## 两种使用模式（重要）

知识库有两条路径，**行为差别很大**，请按需要选择：

| | 只读检索 | 交给 RAGBox 回答 |
|---|---|---|
| 工具 | `search_knowledge_base` / `list_knowledge_files` / `get_file_chunks` | `ask_in_session` |
| 谁回答 | 你的当前模型 | RAGBox 自己的模型 |
| 是否落库 | **否** | **是**（提问与回答都保存） |
| 网页端可见 | **否** | 是，且网页开着该会话时会自动刷新 |
| 适用 | 只想马上拿答案 | 希望这段对话留存、可回看、带引用来源 |

**如果你在 MCP 客户端里问完，发现网页上没有，几乎总是因为走了只读检索。** 改成明确要求
RAGBox 自己回答即可，例如说「用 RAGBox 的会话问一下……」，或「新建一个 RAGBox 会话并提问……」。

服务在初始化时会把这套区别作为说明下发给客户端模型，正常情况下它会自行按你的意图选择；
万一选错了，用上面的话术纠正一次即可。

图表默认走 `generate_chart`（直接把图片返回给客户端，不产生会话记录）；
若 RAGBox 在会话中自行生成了图表，`ask_in_session` 也会把图片内联取回。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `RAGBOX_API_URL` | 否 | `http://127.0.0.1:3001/v1` | RAGBox 后端地址（含 `/v1`） |
| `RAGBOX_TOKEN` | **是** | — | 个人访问令牌 |
| `RAGBOX_TIMEOUT_MS` | 否 | `15000` | 普通请求超时 |
| `RAGBOX_STREAM_TIMEOUT_MS` | 否 | `120000` | 流式对话超时（RAG 生成较慢，单独放宽） |

本地调试时也可把上述变量写进本目录的 `.env`（参考 `.env.example`），`npm run dev` 会自动读取。

## 提供的工具

**知识库（只读，不落库、不调用对话模型）**

- `search_knowledge_base` —— 语义检索，返回原文片段、文件名、页码与相似度分数
- `list_knowledge_files` —— 列出文件及入库状态（只有 `indexed` 才能被检索到）
- `get_file_chunks` —— 分页读取某个文件的分块原文

**图表**

- `generate_chart` —— 按给定数值生成折线图/柱状图，直接返回 PNG 图片

**会话（与网页共享）**

- `list_sessions` / `create_session` / `get_session_messages`
- `ask_in_session` —— 在指定会话中提问，由 RAGBox 自身的检索与对话模型作答。
  提问与回答都会落库，**网页端打开同一会话即可看到**，无需复制粘贴。

**诊断**

- `ragbox_status` —— 检查后端连通性、令牌有效性与权限

## 常见问题

**工具报「令牌无效或已过期」**
在网页重新生成令牌并更新客户端配置中的 `RAGBOX_TOKEN`，然后重启客户端。

**工具报「当前令牌缺少 xxx 权限」**
到网页 **外部接入** 找到该令牌，重新生成一枚带所需权限的令牌（已在用的令牌无法追加权限）。

**工具报「无法连接 RAGBox 后端」**
`backend-server` 没有启动，或 `RAGBOX_API_URL` 填错。先确认浏览器能打开 http://127.0.0.1:3001/health。

**检索结果为空**
知识库里没有已入库的文件（用 `list_knowledge_files` 确认状态是 `indexed`），
或相关度阈值偏高。注意检索向量与入库向量必须来自同一个 embedding 模型 ——
若中途在「模型设置」里换过向量模型，旧文件需要重新入库。

**网页上看不到 agent 里的对话**
确认用的是同一个账号的令牌；另外网页需要保持在该会话页面上，实时刷新依赖会话事件流。
若刚升级到本版本，请重启一次 `backend-server`。

## 开发者说明

```bash
npm run dev        # 以 tsx 直接运行源码
npm run build      # 编译到 dist/
npm run typecheck  # 仅类型检查
npm test           # stdio 握手与工具清单冒烟测试
```

stdio 传输下 **stdout 是 JSON-RPC 通道**，所有日志必须走 stderr（`console.error`），
否则会污染协议流导致客户端解析失败。
