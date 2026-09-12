#!/usr/bin/env bash
# 一键启动（Git Bash / Linux / macOS）
#
# 用法：
#   1) 先激活 AI-server 的 Python 环境：conda activate LCenv
#      （或执行时传入环境变量：AI_PYTHON=/path/to/envs/LCenv/bin/python ./start-all.sh）
#   2) bash start-all.sh
#
# 会自动通过 Docker 启动基础设施（PostgreSQL / Qdrant / Prometheus / Grafana），
# 再以本地进程方式启动三个应用服务，日志写入 .logs/ 目录。
# 按 Ctrl+C 停止应用服务（基础设施容器保持运行，可用 docker compose stop 停止）。

set -uo pipefail
cd "$(dirname "$0")" || exit 1

LOG_DIR="$PWD/.logs"
mkdir -p "$LOG_DIR"

echo "============================================"
echo "   RAGBox 一键启动"
echo "============================================"

# ---------- 0) 工具检查 ----------
command -v node >/dev/null 2>&1 || { echo "[x] 未找到 Node.js"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "[x] 未找到 npm"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "[x] 未找到 Docker（PostgreSQL/Qdrant 等基础设施由它托管）"; exit 1; }
docker info >/dev/null 2>&1 || { echo "[x] Docker 守护进程未运行，请先启动 Docker Desktop"; exit 1; }

# ---------- 1) 生成缺失的 .env ----------
for dir in backend-server AI-server client; do
  if [ -f "$dir/.env.example" ] && [ ! -f "$dir/.env" ]; then
    cp "$dir/.env.example" "$dir/.env"
    echo "[i] 已生成 $dir/.env（嵌入模型等凭据需要填写）"
  fi
done

# ---------- 2) 基础设施容器（PostgreSQL / Qdrant / 监控）----------
echo "[i] 启动基础设施容器（postgres / qdrant / prometheus / grafana）..."
docker compose up -d postgres qdrant prometheus grafana || { echo "[x] 基础设施容器启动失败"; exit 1; }

echo "[i] 等待 PostgreSQL 就绪..."
for i in $(seq 1 30); do
  health="$(docker inspect --format '{{.State.Health.Status}}' ragbox-postgres 2>/dev/null || echo starting)"
  [ "$health" = "healthy" ] && { echo "[i] PostgreSQL healthy"; break; }
  [ "$i" = "30" ] && { echo "[x] PostgreSQL 未在 150 秒内就绪"; exit 1; }
  sleep 5
done

# ---------- 3) backend-server 依赖与数据库 ----------
if [ ! -d backend-server/node_modules ]; then
  echo "[i] 安装 backend-server 依赖..."
  ( cd backend-server && npm install --no-audit --no-fund && npx prisma generate ) || exit 1
fi
echo "[i] 同步数据库结构（幂等）..."
( cd backend-server && npx prisma migrate deploy ) || {
  echo "[x] 数据库迁移失败。检查 DATABASE_URL 与 PostgreSQL 状态。"
  echo "    提示：若从旧版 SQLite 升级，参考 scripts/etl-sqlite-to-pg.mts 或使用全新空库。"
  exit 1
}

# ---------- 4) client 依赖 ----------
if [ ! -d client/node_modules ]; then
  echo "[i] 安装 client 依赖..."
  ( cd client && npm install --no-audit --no-fund ) || exit 1
fi

# ---------- 5) AI-server Python 环境 ----------
AI_PY="${AI_PYTHON:-python}"
echo "[i] AI-server 使用 Python: $AI_PY"
if ! "$AI_PY" -c "import fastapi,uvicorn,httpx,dotenv,langchain_core,langchain_community,langchain_openai,langchain_text_splitters,langchain_qdrant,qdrant_client,prometheus_client,matplotlib,zhipuai" >/dev/null 2>&1; then
  echo "[i] AI-server 依赖缺失，开始安装（首次可能需要几分钟）..."
  "$AI_PY" -m pip install -r AI-server/requirements.txt || exit 1
fi

# ---------- 6) 启动三个应用服务 ----------
echo "[i] 正在启动三个应用服务（日志见 .logs/）..."
( cd backend-server && exec npm run dev ) >"$LOG_DIR/backend.log" 2>&1 &
PID_BACKEND=$!
( cd AI-server && exec "$AI_PY" main.py ) >"$LOG_DIR/ai.log" 2>&1 &
PID_AI=$!
( cd client && exec npm run dev ) >"$LOG_DIR/client.log" 2>&1 &
PID_CLIENT=$!

# 记录 PID 供 stop-all.sh 使用
printf '%s
%s
%s
' "$PID_BACKEND" "$PID_AI" "$PID_CLIENT" > "$LOG_DIR/services.pids"

cleanup() {
  echo ""
  echo "正在停止应用服务（基础设施容器保持运行，docker compose stop 可停止）..."
  kill "$PID_BACKEND" "$PID_AI" "$PID_CLIENT" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo ""
echo "已启动，访问地址："
echo "  前端页面       http://localhost:5173"
echo "  后端健康检查   http://127.0.0.1:3001/health"
echo "  AI 健康检查    http://127.0.0.1:8000/health"
echo "  监控面板       http://127.0.0.1:3000（admin / ragbox-dev-password）"
echo "  Prometheus     http://127.0.0.1:9090"
echo "  日志目录       .logs/"
echo ""
echo "说明：PostgreSQL / Qdrant 由 Docker 容器托管；按 Ctrl+C 只停止应用服务。"
echo "按 Ctrl+C 停止所有应用服务。"
echo "============================================"

wait
