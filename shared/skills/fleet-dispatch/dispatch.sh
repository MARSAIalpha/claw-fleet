#!/bin/bash
# 龙虾舰队调度脚本 — 总控虾通过 SSH 调度其他虾
# 用法: dispatch.sh <机器名> "<消息>"
# 示例: dispatch.sh macmini "【评估任务】请评估写一个计算器应用"

set -euo pipefail

MACHINE="$1"
MESSAGE="$2"
CONFIG_FILE="${FLEET_CONFIG:-$(dirname "$0")/../../fleet-config.json}"

if [ ! -f "$CONFIG_FILE" ]; then
  # fallback: 尝试常见路径
  for p in ~/claw-fleet/fleet-config.json ~/Developer/claw-fleet/fleet-config.json; do
    [ -f "$p" ] && CONFIG_FILE="$p" && break
  done
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "ERROR: fleet-config.json not found" >&2
  exit 1
fi

# 从 fleet-config.json 读取机器信息
read -r IP USER PLATFORM <<< "$(python3 -c "
import json, sys
with open('$CONFIG_FILE') as f:
    cfg = json.load(f)
m = cfg.get('machines', {}).get('$MACHINE')
if not m:
    print('ERROR: machine $MACHINE not found', file=sys.stderr)
    sys.exit(1)
print(m['tailscale_ip'], m['ssh_user'], m['platform'])
")"

# 构造远程命令
ESCAPED_MSG=$(printf '%s' "$MESSAGE" | sed "s/'/'\\\\''/g")

# 群 chat_id 和指挥中心 topic
GROUP_CHAT_ID="-1003534331530"

if [ "$PLATFORM" = "win32" ]; then
  REMOTE_CMD="openclaw agent --agent main --channel telegram --deliver --reply-to ${GROUP_CHAT_ID} -m '${ESCAPED_MSG}'"
else
  REMOTE_CMD="export PATH=/opt/homebrew/bin:/usr/local/bin:\$PATH && openclaw agent --agent main --channel telegram --deliver --reply-to ${GROUP_CHAT_ID} -m '${ESCAPED_MSG}'"
fi

echo "📡 调度 → $MACHINE ($USER@$IP)" >&2

# SSH 执行，失败则 fallback 到 tailscale ssh
ssh -o StrictHostKeyChecking=no \
    -o ConnectTimeout=10 \
    -o ServerAliveInterval=30 \
    "$USER@$IP" \
    "$REMOTE_CMD" 2>/dev/null \
|| tailscale ssh "$USER@$IP" "$REMOTE_CMD" 2>/dev/null \
|| { echo "ERROR: SSH to $MACHINE failed" >&2; exit 1; }
