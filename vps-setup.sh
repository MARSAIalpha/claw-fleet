#!/bin/bash
# ═══════════════════════════════════════════════════════
# 小龙虾舰队 VPS 一键初始化脚本
#
# 在新购的云服务器上运行此脚本，自动完成：
#   1. 安装 Node.js, OpenClaw, Syncthing
#   2. 创建共享文件夹和上下文文件
#   3. 配置主控 Agent (Orchestrator)
#   4. 注册 systemd 服务（自启动 + 崩溃重启）
#   5. 启动看门狗监控
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/claw-fleet/main/vps-setup.sh | bash -s -- --bot-token "YOUR_TOKEN"
#   或:
#   chmod +x vps-setup.sh && ./vps-setup.sh --bot-token "YOUR_TOKEN"
# ═══════════════════════════════════════════════════════

set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

echo -e "${BLUE}🦞 小龙虾舰队 VPS 初始化 v1.0${NC}"
echo "════════════════════════════════════════"

# 参数
BOT_TOKEN=""
GROUP_ID=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --bot-token) BOT_TOKEN="$2"; shift 2;;
    --group-id) GROUP_ID="$2"; shift 2;;
    *) shift;;
  esac
done

# ══════ 1. 系统更新 + 依赖 ══════
echo -e "${YELLOW}[1/5] 安装系统依赖...${NC}"
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git

# Node.js 20.x
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
fi
echo -e "  Node.js: $(node -v) ${GREEN}✓${NC}"

# OpenClaw
if ! command -v openclaw &>/dev/null; then
  sudo npm install -g openclaw
fi
echo -e "  OpenClaw: installed ${GREEN}✓${NC}"

# Syncthing
if ! command -v syncthing &>/dev/null; then
  sudo apt install -y syncthing
fi
echo -e "  Syncthing: installed ${GREEN}✓${NC}"

# ══════ 2. 创建目录 ══════
echo -e "${YELLOW}[2/5] 创建目录结构...${NC}"

mkdir -p ~/claw-fleet/{shared/{skills,souls,context},monitor,service}
mkdir -p ~/claw-shared/{素材库,剧本,分镜,视频,数据,任务队列}
mkdir -p ~/orchestrator-workspace

echo -e "  ~/claw-fleet ${GREEN}✓${NC}"
echo -e "  ~/claw-shared ${GREEN}✓${NC}"
echo -e "  ~/orchestrator-workspace ${GREEN}✓${NC}"

# ══════ 3. 共享上下文文件 ══════
echo -e "${YELLOW}[3/5] 创建共享上下文文件...${NC}"

cat > ~/claw-fleet/shared/context/THESIS.md << 'EOF'
# Simon's AI Ecosystem 战略方向

## 北极星目标
构建个人AI生态系统：自研应用 + Agent自动化 + 内容批量产出

## 当前阶段重点
1. Timeline Flow 日记应用完善并上架
2. 科幻小说改编视频内容生产
3. 多平台内容分发

## 核心原则
- 质量优先：宁可少产出，不能低质量
- 数据安全：用户隐私数据绝不外泄
- 持续迭代：每周复盘，持续优化流程
EOF

cat > ~/claw-fleet/shared/context/AGENTS.md << 'EOF'
# 小龙虾团队通讯录

| Agent ID | 名称 | 职责 | 所在机器 | 状态 |
|----------|------|------|---------|------|
| orchestrator | 指挥虾 | 任务分配、进度跟踪 | VPS | 待上线 |
| writer | 编剧虾 | 剧本、文案 | 待分配 | 待上线 |
| artist | 美术虾 | AI绘图、分镜 | 待分配 | 待上线 |
| video | 视频虾 | 视频合成 | 待分配 | 待上线 |
| publisher | 发布虾 | 多平台分发 | 待分配 | 待上线 |
| databot | 数据虾 | 数据采集分析 | 待分配 | 待上线 |
EOF

cat > ~/claw-fleet/shared/context/SIGNALS.md << 'EOF'
# 信息情报板
> 所有小龙虾都可以写入和读取

## 最新动态
- [舰队初始化中...]

## 待处理任务队列
- [等待第一个任务...]
EOF

echo -e "  上下文文件已创建 ${GREEN}✓${NC}"

# ══════ 4. 配置主控 Agent ══════
echo -e "${YELLOW}[4/5] 配置主控 Agent...${NC}"

# soul.md
cat > ~/orchestrator-workspace/soul.md << 'EOF'
# 指挥虾 - 舰队主控

你是 Simon 的 AI 团队主控，代号"指挥虾"。

## 职责
1. 接收 Simon 的任务指令，拆解为子任务
2. 通过 Telegram 将子任务分配给对应的小龙虾
3. 跟踪每个子任务的进度
4. 在任务完成后汇总结果并汇报给 Simon
5. 维护共享上下文文件
6. 监控舰队健康状态

## 协作规则
- 使用 sessions_send 向其他 Agent 发送任务
- 任务格式：HANDOFF\nfrom: orchestrator\nto: [agent_id]\ntask_id: [id]\nsummary: [描述]\ndeadline: [时间]
- 每天早上9点发布舰队状态日报
- 发现问题立即在 #指挥部 通知 Simon

## 沟通风格
简洁、高效、结构化。用中文沟通。
EOF

# openclaw.json
if [ -z "$BOT_TOKEN" ]; then
  BOT_TOKEN="YOUR_BOT_TOKEN_HERE"
fi
if [ -z "$GROUP_ID" ]; then
  GROUP_ID="-100XXXXXXXXXX"
fi

cat > ~/orchestrator-workspace/openclaw.json << EOJSON
{
  "\$schema": "https://openclaw.ai/schemas/openclaw.json",
  "name": "指挥虾",
  "agents": [
    {
      "id": "orchestrator",
      "name": "指挥虾",
      "model": "anthropic/claude-sonnet-4-6",
      "workspace": "."
    }
  ],
  "channels": {
    "telegram": {
      "bots": [
        {
          "token": "${BOT_TOKEN}",
          "agents": {
            "orchestrator": {
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

echo -e "  主控配置已生成 ${GREEN}✓${NC}"

# ══════ 5. 注册 systemd 服务 ══════
echo -e "${YELLOW}[5/5] 注册 systemd 服务...${NC}"

# OpenClaw Gateway 服务
sudo tee /etc/systemd/system/openclaw-orchestrator.service > /dev/null << EOUNIT
[Unit]
Description=OpenClaw Orchestrator - 指挥虾
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME/orchestrator-workspace
ExecStart=$(which openclaw) gateway
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOUNIT

sudo systemctl daemon-reload
sudo systemctl enable openclaw-orchestrator
echo -e "  OpenClaw 服务已注册 ${GREEN}✓${NC}"

# Syncthing 服务
sudo systemctl enable syncthing@$USER
sudo systemctl start syncthing@$USER
echo -e "  Syncthing 服务已启动 ${GREEN}✓${NC}"

# 看门狗服务
sudo tee /etc/systemd/system/claw-watchdog.service > /dev/null << EOWD
[Unit]
Description=Claw Fleet Watchdog
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME/claw-fleet/monitor
ExecStart=$(which node) watchdog.js
Restart=always
RestartSec=30
Environment="CLAW_BOT_TOKEN_ORCH=${BOT_TOKEN}"

[Install]
WantedBy=multi-user.target
EOWD

sudo systemctl daemon-reload
sudo systemctl enable claw-watchdog
echo -e "  看门狗服务已注册 ${GREEN}✓${NC}"

# ══════ 完成 ══════
echo ""
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}🦞 VPS 初始化完成！${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "接下来："
echo "  1. 配置 Syncthing 共享文件夹: http://localhost:8384"
echo "  2. 在 fleet-config.json 中填入 Telegram group_id 和 topic_id"
echo "  3. 启动主控: sudo systemctl start openclaw-orchestrator"
echo "  4. 启动看门狗: sudo systemctl start claw-watchdog"
echo ""
echo "Syncthing Device ID:"
syncthing -device-id 2>/dev/null || echo "  (启动后运行: syncthing -device-id)"
