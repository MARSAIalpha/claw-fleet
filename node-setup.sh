#!/bin/bash
# ═══════════════════════════════════════════════════════
# 小龙虾节点一键部署脚本 (macOS / Linux)
#
# 用法:
#   chmod +x node-setup.sh
#   ./node-setup.sh --agent-id writer --bot-token "YOUR_BOT_TOKEN"
#
# 此脚本会：
#   1. 检查并安装依赖（Node.js, OpenClaw, Syncthing）
#   2. 从共享文件夹读取配置，自动生成 openclaw.json
#   3. 注册 OpenClaw Gateway 为 launchd 自启动服务（macOS）
#   4. 启动心跳监控
# ═══════════════════════════════════════════════════════

set -e

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🦞 小龙虾节点部署脚本 v1.0${NC}"
echo "════════════════════════════════════════"

# ── 参数解析 ──
AGENT_ID=""
BOT_TOKEN=""
CLAW_SHARED="$HOME/claw-shared"
WORKSPACE_BASE="$HOME/openclaw"

while [[ $# -gt 0 ]]; do
  case $1 in
    --agent-id) AGENT_ID="$2"; shift 2;;
    --bot-token) BOT_TOKEN="$2"; shift 2;;
    --shared-dir) CLAW_SHARED="$2"; shift 2;;
    --workspace) WORKSPACE_BASE="$2"; shift 2;;
    *) echo "Unknown option: $1"; exit 1;;
  esac
done

if [ -z "$AGENT_ID" ]; then
  echo -e "${RED}错误: 必须指定 --agent-id${NC}"
  echo "可选值: orchestrator, writer, artist, video, publisher, databot"
  exit 1
fi

echo -e "${GREEN}Agent ID: ${AGENT_ID}${NC}"
echo -e "${GREEN}共享目录: ${CLAW_SHARED}${NC}"
echo -e "${GREEN}工作目录: ${WORKSPACE_BASE}/${AGENT_ID}-workspace${NC}"
echo ""

# ══════ 1. 检查依赖 ══════
echo -e "${YELLOW}[1/6] 检查依赖...${NC}"

# Node.js
if ! command -v node &>/dev/null; then
  echo "安装 Node.js..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    if command -v brew &>/dev/null; then
      brew install node
    else
      echo -e "${RED}请先安装 Homebrew: https://brew.sh${NC}"
      exit 1
    fi
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
  fi
fi
echo -e "  Node.js: $(node -v) ${GREEN}✓${NC}"

# OpenClaw
if ! command -v openclaw &>/dev/null; then
  echo "安装 OpenClaw..."
  npm install -g openclaw
fi
echo -e "  OpenClaw: $(openclaw --version 2>/dev/null || echo 'installed') ${GREEN}✓${NC}"

# Syncthing
if ! command -v syncthing &>/dev/null; then
  echo "安装 Syncthing..."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    brew install syncthing
  else
    sudo apt install -y syncthing
  fi
fi
echo -e "  Syncthing: $(syncthing --version 2>/dev/null | head -1 || echo 'installed') ${GREEN}✓${NC}"

# ══════ 2. 创建目录结构 ══════
echo -e "${YELLOW}[2/6] 创建目录结构...${NC}"

WORKSPACE="${WORKSPACE_BASE}/${AGENT_ID}-workspace"
mkdir -p "$WORKSPACE"
mkdir -p "$CLAW_SHARED"/{context,素材库,剧本,分镜,视频,数据,任务队列}
echo -e "  工作区: ${WORKSPACE} ${GREEN}✓${NC}"
echo -e "  共享区: ${CLAW_SHARED} ${GREEN}✓${NC}"

# ══════ 3. 生成 OpenClaw 配置 ══════
echo -e "${YELLOW}[3/6] 生成 OpenClaw 配置...${NC}"

# 从 fleet-config.json 读取 Agent 信息
FLEET_CONFIG="${CLAW_SHARED}/../claw-fleet/fleet-config.json"
if [ ! -f "$FLEET_CONFIG" ]; then
  FLEET_CONFIG="${WORKSPACE_BASE}/claw-fleet/fleet-config.json"
fi

# 获取 Agent 配置（如果 fleet-config 存在）
AGENT_NAME="$AGENT_ID"
AGENT_MODEL="deepseek/deepseek-chat"
GROUP_ID="-100XXXXXXXXXX"
TOPIC_ID="0"

if [ -f "$FLEET_CONFIG" ]; then
  echo "  从 fleet-config.json 读取配置..."
  # 使用 node 解析 JSON（兼容性最好）
  AGENT_NAME=$(node -e "
    const c = require('$FLEET_CONFIG');
    const a = c.agents.find(a => a.id === '$AGENT_ID');
    console.log(a ? a.name : '$AGENT_ID');
  " 2>/dev/null || echo "$AGENT_ID")

  AGENT_MODEL=$(node -e "
    const c = require('$FLEET_CONFIG');
    const a = c.agents.find(a => a.id === '$AGENT_ID');
    console.log(a ? a.model : 'deepseek/deepseek-chat');
  " 2>/dev/null || echo "deepseek/deepseek-chat")

  GROUP_ID=$(node -e "
    const c = require('$FLEET_CONFIG');
    console.log(c.fleet.telegram.group_id);
  " 2>/dev/null || echo "-100XXXXXXXXXX")
fi

# Bot Token
if [ -z "$BOT_TOKEN" ]; then
  ENV_VAR="CLAW_BOT_TOKEN_$(echo $AGENT_ID | tr '[:lower:]' '[:upper:]')"
  BOT_TOKEN="${!ENV_VAR}"
fi

if [ -z "$BOT_TOKEN" ]; then
  echo -e "${YELLOW}  警告: 未提供 Bot Token，请稍后手动配置 openclaw.json${NC}"
  BOT_TOKEN="YOUR_BOT_TOKEN_HERE"
fi

# 生成 openclaw.json
cat > "${WORKSPACE}/openclaw.json" << EOJSON
{
  "\$schema": "https://openclaw.ai/schemas/openclaw.json",
  "name": "${AGENT_NAME}",
  "agents": [
    {
      "id": "${AGENT_ID}",
      "name": "${AGENT_NAME}",
      "model": "${AGENT_MODEL}",
      "workspace": "."
    }
  ],
  "channels": {
    "telegram": {
      "bots": [
        {
          "token": "${BOT_TOKEN}",
          "agents": {
            "${AGENT_ID}": {
              "groups": {
                "${GROUP_ID}": {
                  "requireMention": true
                }
              }
            }
          }
        }
      ]
    }
  }
}
EOJSON

echo -e "  openclaw.json 已生成 ${GREEN}✓${NC}"

# ══════ 4. 复制/链接 Soul 和 Skills ══════
echo -e "${YELLOW}[4/6] 配置 Soul 和 Skills...${NC}"

SOUL_SOURCE="${CLAW_SHARED}/../claw-fleet/shared/souls/${AGENT_ID}.md"
if [ -f "$SOUL_SOURCE" ]; then
  cp "$SOUL_SOURCE" "${WORKSPACE}/soul.md"
  echo -e "  soul.md 已复制 ${GREEN}✓${NC}"
else
  echo -e "  ${YELLOW}soul.md 不存在，将使用默认配置${NC}"
  cat > "${WORKSPACE}/soul.md" << EOSOUL
# ${AGENT_NAME}

你是 Simon AI 团队的 ${AGENT_NAME}。

## 职责
请根据任务指令完成工作，完成后在 Telegram 群组汇报。

## 协作规则
- 文件产出保存到共享文件夹: ${CLAW_SHARED}
- 完成任务后通知主控虾
- 遇到问题及时上报
EOSOUL
fi

# 链接共享 Skills 目录
if [ -d "${CLAW_SHARED}/../claw-fleet/shared/skills" ]; then
  ln -sf "${CLAW_SHARED}/../claw-fleet/shared/skills" "${WORKSPACE}/skills"
  echo -e "  Skills 已链接 ${GREEN}✓${NC}"
fi

# ══════ 5. 注册自启动服务 ══════
echo -e "${YELLOW}[5/6] 注册自启动服务...${NC}"

if [[ "$OSTYPE" == "darwin"* ]]; then
  # macOS: 使用 launchd
  PLIST_PATH="$HOME/Library/LaunchAgents/com.simon.openclaw.${AGENT_ID}.plist"

  cat > "$PLIST_PATH" << EOPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.simon.openclaw.${AGENT_ID}</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which openclaw)</string>
        <string>gateway</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${WORKSPACE}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${WORKSPACE}/gateway.log</string>
    <key>StandardErrorPath</key>
    <string>${WORKSPACE}/gateway-error.log</string>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
EOPLIST

  launchctl load "$PLIST_PATH" 2>/dev/null || true
  echo -e "  macOS launchd 服务已注册 ${GREEN}✓${NC}"
  echo -e "  进程崩溃后会自动重启"

  # 心跳服务
  HEARTBEAT_PLIST="$HOME/Library/LaunchAgents/com.simon.claw-heartbeat.${AGENT_ID}.plist"
  cat > "$HEARTBEAT_PLIST" << EOHB
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.simon.claw-heartbeat.${AGENT_ID}</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>${WORKSPACE_BASE}/claw-fleet/monitor/heartbeat.js</string>
        <string>--agent-id</string>
        <string>${AGENT_ID}</string>
        <string>--interval</string>
        <string>300</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${WORKSPACE}/heartbeat.log</string>
</dict>
</plist>
EOHB

  launchctl load "$HEARTBEAT_PLIST" 2>/dev/null || true
  echo -e "  心跳监控服务已注册 ${GREEN}✓${NC}"

else
  # Linux: 使用 systemd
  UNIT_PATH="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_PATH"

  cat > "${UNIT_PATH}/openclaw-${AGENT_ID}.service" << EOUNIT
[Unit]
Description=OpenClaw Agent - ${AGENT_NAME}
After=network.target

[Service]
Type=simple
WorkingDirectory=${WORKSPACE}
ExecStart=$(which openclaw) gateway
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
EOUNIT

  systemctl --user daemon-reload
  systemctl --user enable "openclaw-${AGENT_ID}.service"
  echo -e "  systemd 服务已注册 ${GREEN}✓${NC}"
fi

# ══════ 6. 完成 ══════
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}🦞 ${AGENT_NAME} 节点部署完成！${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "工作目录:  ${WORKSPACE}"
echo "配置文件:  ${WORKSPACE}/openclaw.json"
echo "角色定义:  ${WORKSPACE}/soul.md"
echo "日志文件:  ${WORKSPACE}/gateway.log"
echo ""
echo -e "${YELLOW}后续步骤:${NC}"
echo "  1. 确认 Bot Token 已正确配置"
echo "  2. 确认 Syncthing 已连接到 VPS"
echo "  3. 启动 Gateway:"
echo "     cd ${WORKSPACE} && openclaw gateway"
echo "  4. 或使用系统服务启动:"
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "     launchctl start com.simon.openclaw.${AGENT_ID}"
else
  echo "     systemctl --user start openclaw-${AGENT_ID}"
fi
echo ""
echo -e "${BLUE}管理命令:${NC}"
echo "  查看状态:  openclaw agents list --bindings"
echo "  查看日志:  tail -f ${WORKSPACE}/gateway.log"
echo "  停止服务:  launchctl stop com.simon.openclaw.${AGENT_ID}"
echo "  更新配置:  从 Syncthing 同步后自动生效"
