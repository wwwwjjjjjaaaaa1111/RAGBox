#!/usr/bin/env bash
# 一键启动（Git Bash / Linux / macOS）
#
# 用法：
#   1) 先激活 AI-server 的 Python 环境：conda activate LCenv
#      （或执行时传入环境变量：AI_PYTHON=/path/to/envs/LCenv/bin/python ./start-all.sh）
#   2) bash start-all.sh
#
# 三个服务以后台方式运行，日志写入 .logs/ 目录。
# 按 Ctrl+C 会同时停止三个服务。

set -uo pipefail
cd "$(dirname "$0")" || exit 1

LOG_DIR="$PWD/.logs"
mkdir -p "$LOG_DIR"

echo "============================================"
echo "   AI-CHAT-RAG 一键启动"
echo "============================================"

# ---------- 0) 工具检查 ----------
command -v node >/dev/null 2>&1 || { echo "[x] 未找到 Node.js"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "[x] 未找到 npm"; exit 1; }

# ---------- 1) 生成缺失的 .env ----------
for dir in backend-server AI-server client; do
  if [ -f "$dir/.env.example" ] && [ ! -f "$dir/.env" ]; then
    cp "$dir/.env.example" "$dir/.env"
    echo "[i] 已生成 $dir/.env"
  fi
done

# ---------- 2) backend-server 依赖与数据库 ----------
if [ ! -d backend-server/node_modules ]; then
  echo "[i] 安装 backend-server 依赖..."
  ( cd backend-server && npm install --no-audit --no-fund && npx prisma generate ) || exit 1
fi
if [ ! -f backend-server/prisma/dev.db ]; then
  echo "[i] 初始化数据库..."
  ( cd backend-server && npx prisma migrate deploy ) || exit 1
fi

# ---------- 3) client 依赖 ----------
if [ ! -d client/node_modules ]; then
  echo "[i] 安装 client 依赖..."
  ( cd client && npm install --no-audit --no-fund ) || exit 1
fi

# ---------- 4) AI-server Python 环境 ----------
AI_PY="${AI_PYTHON:-python}"
echo "[i] AI-server 使用 Python: $AI_PY"
if ! "$AI_PY" -c "import fastapi,uvicorn,httpx,dotenv,chromadb,langchain_core,langchain_community,langchain_chroma,langchain_openai,langchain_text_splitters,zhipuai" >/dev/null 2>&1; then
  echo "[i] AI-server 依赖缺失，开始安装（首次可能需要几分钟）..."
  "$AI_PY" -m pip install -r AI-server/requirements.txt || exit 1
fi

# ---------- 5) 启动三个服务 ----------
echo "[i] 正在启动三个服务（日志见 .logs/）..."
( cd backend-server && exec npm run dev ) >"$LOG_DIR/backend.log" 2>&1 &
PID_BACKEND=$!
( cd AI-server && exec "$AI_PY" main.py ) >"$LOG_DIR/ai.log" 2>&1 &
PID_AI=$!
( cd client && exec npm run dev ) >"$LOG_DIR/client.log" 2>&1 &
PID_CLIENT=$!

cleanup() {
  echo ""
  echo "正在停止所有服务..."
  kill "$PID_BACKEND" "$PID_AI" "$PID_CLIENT" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM

echo ""
echo "已启动，访问地址："
echo "  前端页面     http://localhost:5173"
echo "  后端健康检查 http://127.0.0.1:3001/health"
echo "  AI 健康检查  http://127.0.0.1:8000/health"
echo "  日志目录     .logs/"
echo "按 Ctrl+C 停止所有服务。"
echo "============================================"

wait
