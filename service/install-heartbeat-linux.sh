#!/bin/bash
# install-heartbeat-linux.sh
# 在 Linux (VPS/Ubuntu) 上一键安装心跳服务（systemd 自启动）
#
# 用法: sudo bash install-heartbeat-linux.sh --agent-id vps
# 卸载: sudo bash install-heartbeat-linux.sh --uninstall

set -e

AGENT_ID=""
INTERVAL=30
UNINSTALL=false
FLEET_DIR=""
SERVICE_NAME="claw-heartbeat"

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-id) AGENT_ID="$2"; shift 2;;
    --interval) INTERVAL="$2"; shift 2;;
    --uninstall) UNINSTALL=true; shift;;
    *) shift;;
  esac
done

# 定位 claw-fleet
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/../monitor/heartbeat.js" ]; then
  FLEET_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
elif [ -f "$HOME/claw-fleet/monitor/heartbeat.js" ]; then
  FLEET_DIR="$HOME/claw-fleet"
else
  echo "[ERROR] Cannot find claw-fleet directory"
  exit 1
fi

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
STATUS_FILE="$FLEET_DIR/shared/fleet-status.json"

# ── 卸载 ──
if [ "$UNINSTALL" = true ]; then
  echo "[*] Stopping and removing $SERVICE_NAME..."
  systemctl stop $SERVICE_NAME 2>/dev/null || true
  systemctl disable $SERVICE_NAME 2>/dev/null || true
  rm -f "$SERVICE_FILE"
  systemctl daemon-reload
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
  echo "[ERROR] Node.js not found. Install: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  exit 1
fi
echo "[OK] Node.js: $($NODE_PATH --version)"

RUN_USER="${SUDO_USER:-root}"
mkdir -p "$(dirname "$STATUS_FILE")"

# ── 写 systemd service ──
cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=Claw Fleet Heartbeat ($AGENT_ID)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$FLEET_DIR/monitor
ExecStart=$NODE_PATH $FLEET_DIR/monitor/heartbeat.js --agent-id $AGENT_ID --interval $INTERVAL --status-file $STATUS_FILE
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=claw-heartbeat
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

# ── 启动服务 ──
systemctl daemon-reload
systemctl enable $SERVICE_NAME
systemctl restart $SERVICE_NAME

echo ""
echo "========================================"
echo " Heartbeat service installed!"
echo "========================================"
echo "  Agent ID : $AGENT_ID"
echo "  Interval : ${INTERVAL}s"
echo "  Status   : $STATUS_FILE"
echo "  Service  : $SERVICE_NAME"
echo "  User     : $RUN_USER"
echo ""

# 等一下检查状态
sleep 2
if systemctl is-active --quiet $SERVICE_NAME; then
  echo "  [RUNNING] Heartbeat is active."
else
  echo "  [FAILED] Check: journalctl -u $SERVICE_NAME -f"
fi
echo ""
echo "  Check:   systemctl status $SERVICE_NAME"
echo "  Logs:    journalctl -u $SERVICE_NAME -f"
echo "  Stop:    systemctl stop $SERVICE_NAME"
echo "  Uninstall: sudo bash $0 --uninstall"
