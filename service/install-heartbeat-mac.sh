#!/bin/bash
# install-heartbeat-mac.sh
# 在 macOS 上一键安装心跳服务（launchd 开机自启动）
#
# 用法: bash install-heartbeat-mac.sh --agent-id macmini
# 卸载: bash install-heartbeat-mac.sh --uninstall

set -e

AGENT_ID=""
INTERVAL=30
UNINSTALL=false
FLEET_DIR=""
LABEL="com.clawfleet.heartbeat"

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-id) AGENT_ID="$2"; shift 2;;
    --interval) INTERVAL="$2"; shift 2;;
    --uninstall) UNINSTALL=true; shift;;
    *) shift;;
  esac
done

# 定位 claw-fleet 目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/../monitor/heartbeat.js" ]; then
  FLEET_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [ -f "$HOME/claw-fleet/monitor/heartbeat.js" ]; then
  FLEET_DIR="$HOME/claw-fleet"
else
  echo "[ERROR] Cannot find claw-fleet directory"
  exit 1
fi

PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
STATUS_FILE="$FLEET_DIR/shared/fleet-status.json"
LOG_FILE="$FLEET_DIR/service/heartbeat.log"

# ── 卸载 ──
if [ "$UNINSTALL" = true ]; then
  echo "[*] Unloading $LABEL..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  rm -f "$PLIST_PATH"
  echo "[OK] Heartbeat service removed."
  exit 0
fi

# ── 检查 ──
if [ -z "$AGENT_ID" ]; then
  AGENT_ID="$(hostname -s | tr '[:upper:]' '[:lower:]')"
  echo "[*] No --agent-id specified, using hostname: $AGENT_ID"
fi

NODE_PATH="$(which node 2>/dev/null || echo "")"
if [ -z "$NODE_PATH" ]; then
  # Homebrew 路径
  for p in /usr/local/bin/node /opt/homebrew/bin/node; do
    [ -x "$p" ] && NODE_PATH="$p" && break
  done
fi
if [ -z "$NODE_PATH" ]; then
  echo "[ERROR] Node.js not found. Install: brew install node"
  exit 1
fi
echo "[OK] Node.js: $($NODE_PATH --version)"

mkdir -p "$(dirname "$STATUS_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

# ── 写 launchd plist ──
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$FLEET_DIR/monitor/heartbeat.js</string>
        <string>--agent-id</string>
        <string>$AGENT_ID</string>
        <string>--interval</string>
        <string>$INTERVAL</string>
        <string>--status-file</string>
        <string>$STATUS_FILE</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>

    <key>WorkingDirectory</key>
    <string>$FLEET_DIR/monitor</string>

    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
PLIST

# ── 加载服务 ──
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load -w "$PLIST_PATH"

echo ""
echo "========================================"
echo " Heartbeat service installed!"
echo "========================================"
echo "  Agent ID : $AGENT_ID"
echo "  Interval : ${INTERVAL}s"
echo "  Status   : $STATUS_FILE"
echo "  Log      : $LOG_FILE"
echo "  Plist    : $PLIST_PATH"
echo ""
echo "  [RUNNING] Heartbeat is active."
echo "  It will auto-start on every login."
echo ""
echo "  Check: launchctl list | grep claw"
echo "  Stop:  launchctl unload $PLIST_PATH"
