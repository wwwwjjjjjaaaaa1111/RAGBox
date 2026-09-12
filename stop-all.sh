#!/usr/bin/env bash
# 一键停止（Git Bash / Linux / macOS）
#
# 停止 start-all.sh 启动的三个应用服务（读取 .logs/services.pids），
# 并提示基础设施容器的停止方式。

cd "$(dirname "$0")" || exit 1
PID_FILE=".logs/services.pids"

echo "============================================"
echo "   RAGBox 一键停止"
echo "============================================"

stopped=0
if [ -f "$PID_FILE" ]; then
  while read -r pid; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && { echo "  已停止进程 $pid"; stopped=1; }
    fi
  done < "$PID_FILE"
  rm -f "$PID_FILE"
else
  echo "  未找到 $PID_FILE（服务可能未通过 start-all.sh 启动）"
fi

# 兜底：按端口清理仍监听的应用服务进程（Windows Git Bash 下可用）。
if command -v netstat >/dev/null 2>&1 && command -v taskkill >/dev/null 2>&1; then
  for port in 3001 8000 5173; do
    pids="$(netstat -ano -p tcp 2>/dev/null | grep "LISTENING" | grep -E ":$port " | awk '{print $NF}' | sort -u)"
    for pid in $pids; do
      taskkill //PID "$pid" //F >/dev/null 2>&1 && { echo "  已按端口停止 $port（PID $pid）"; stopped=1; }
    done
  done
fi

[ "$stopped" = "1" ] || echo "  没有正在运行的应用服务。"

echo ""
echo "基础设施容器（postgres/qdrant/prometheus/grafana）保持运行，"
echo "如需停止：docker compose stop"
echo "============================================"
