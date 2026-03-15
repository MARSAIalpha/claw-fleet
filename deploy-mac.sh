#!/bin/bash
# ============================================================
# 小龙虾舰队 - macOS 一键部署脚本
# 用法: bash deploy-mac.sh --token "你的BOT_TOKEN" --name "虾的名字"
# 例如: bash deploy-mac.sh --token "123:abc" --name "视频虾"
# ============================================================

set -e

# 默认参数
OWNER_TELEGRAM_ID="6346780385"
GATEWAY_PORT="18789"
VPS_SYNCTHING_ID="PWQNFIY-CQ7OTI5-7Y676LP-3BAFQHL-3N5PCWW-3GCTDIJ-X7S3M25-YWXBQQ3"
VPS_IP="122.152.215.102"
BOT_TOKEN=""
AGENT_NAME=""

# 解析参数
while [[ $# -gt 0 ]]; do
  case $1 in
    --token) BOT_TOKEN="$2"; shift 2 ;;
    --name) AGENT_NAME="$2"; shift 2 ;;
    --owner) OWNER_TELEGRAM_ID="$2"; shift 2 ;;
    --port) GATEWAY_PORT="$2"; shift 2 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

if [ -z "$BOT_TOKEN" ] || [ -z "$AGENT_NAME" ]; then
  echo "用法: bash deploy-mac.sh --token \"BOT_TOKEN\" --name \"Agent名字\""
  echo "例如: bash deploy-mac.sh --token \"123:abc\" --name \"视频虾\""
  exit 1
fi

echo ""
echo "========================================"
echo "  小龙虾舰队 - 一键部署 (macOS)"
echo "  Agent: $AGENT_NAME"
echo "========================================"
echo ""

# ------ Step 1: 检查并安装 Homebrew ------
echo "[1/6] 检查 Homebrew..."
if command -v brew &> /dev/null; then
  echo "  Homebrew 已安装"
else
  echo "  安装 Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo "  Homebrew 安装完成"
fi

# ------ Step 2: 检查并安装 Node.js ------
echo "[2/6] 检查 Node.js..."
if command -v node &> /dev/null; then
  echo "  Node.js 已安装: $(node -v)"
else
  echo "  安装 Node.js..."
  brew install node@20
  echo "  Node.js 安装完成"
fi

# ------ Step 3: 安装 OpenClaw ------
echo "[3/6] 检查 OpenClaw..."
if command -v openclaw &> /dev/null; then
  echo "  OpenClaw 已安装，更新到最新版..."
  npm install -g openclaw@latest 2>/dev/null || true
else
  echo "  安装 OpenClaw..."
  npm install -g openclaw@latest
  echo "  OpenClaw 安装完成"
fi

# ------ Step 4: 生成配置文件 ------
echo "[4/6] 生成配置文件..."
OPENCLAW_DIR="$HOME/.openclaw"
mkdir -p "$OPENCLAW_DIR"
CONFIG_PATH="$OPENCLAW_DIR/openclaw.json"

# 生成随机 gateway token
GATEWAY_TOKEN=$(openssl rand -hex 24)

# 备份已有配置
if [ -f "$CONFIG_PATH" ]; then
  BACKUP_PATH="${CONFIG_PATH}.bak.deploy-$(date +%Y%m%d%H%M%S)"
  cp "$CONFIG_PATH" "$BACKUP_PATH"
  echo "  已备份原配置到: $BACKUP_PATH"
fi

WORKSPACE_PATH="$HOME/clawd"

cat > "$CONFIG_PATH" << JSONEOF
{
  "meta": {
    "lastTouchedVersion": "2026.3.12",
    "lastTouchedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  },
  "auth": {
    "profiles": {
      "zai:default": {
        "provider": "zai",
        "mode": "api_key"
      },
      "openai-codex:default": {
        "provider": "openai-codex",
        "mode": "oauth"
      }
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "zai": {
        "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
        "api": "openai-completions",
        "models": [
          {
            "id": "glm-5",
            "name": "GLM-5",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 204800,
            "maxTokens": 131072
          },
          {
            "id": "glm-4.7-flash",
            "name": "GLM-4.7 Flash",
            "reasoning": true,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 204800,
            "maxTokens": 131072
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai-codex/gpt-5.4",
        "fallbacks": ["zai/glm-5"]
      },
      "models": {
        "zai/glm-5": { "alias": "GLM" },
        "openai-codex/gpt-5.4": {}
      },
      "workspace": "$WORKSPACE_PATH",
      "compaction": { "mode": "safeguard" },
      "maxConcurrent": 4,
      "subagents": { "maxConcurrent": 8 }
    }
  },
  "tools": {
    "profile": "coding",
    "web": {
      "search": {
        "enabled": true,
        "provider": "kimi",
        "apiKey": "BSAHAML-fbPSNQ9FqMhKrn4Ta5nx4Cv",
        "kimi": {
          "apiKey": "sk-UBiw90yJLbLhhm2VnJlFRVU9Pp7MJ6vdlsvpucyCuCDT1ljK"
        }
      }
    }
  },
  "messages": {
    "ackReactionScope": "group-mentions"
  },
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true,
    "ownerDisplay": "raw"
  },
  "session": {
    "dmScope": "per-channel-peer"
  },
  "hooks": {
    "internal": {
      "enabled": true,
      "entries": {
        "boot-md": { "enabled": true },
        "command-logger": { "enabled": true },
        "session-memory": { "enabled": true },
        "bootstrap-extra-files": { "enabled": true }
      }
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "dmPolicy": "allowlist",
      "botToken": "$BOT_TOKEN",
      "allowFrom": [$OWNER_TELEGRAM_ID],
      "groupPolicy": "open",
      "groups": {},
      "streaming": "partial"
    }
  },
  "gateway": {
    "port": $GATEWAY_PORT,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "$GATEWAY_TOKEN"
    },
    "tailscale": {
      "mode": "off",
      "resetOnExit": false
    }
  },
  "plugins": {
    "entries": {
      "telegram": { "enabled": true },
      "skillhub": {
        "enabled": true,
        "config": {
          "primaryCli": "skillhub",
          "fallbackCli": "clawhub",
          "primaryLabel": "cn-optimized",
          "fallbackLabel": "public-registry"
        }
      }
    }
  }
}
JSONEOF

echo "  配置文件已生成: $CONFIG_PATH"

# ------ Step 5: 创建工作目录 + 安装 Syncthing ------
echo "[5/6] 创建工作目录并检查 Syncthing..."
mkdir -p "$HOME/clawd"
mkdir -p "$HOME/claw-shared"/{新闻组,带货视频组,AI教程组,漫剧教程组,App开发组,公共资源}
mkdir -p "$HOME/claw-fleet"

if command -v syncthing &> /dev/null; then
  echo "  Syncthing 已安装"
else
  echo "  安装 Syncthing..."
  brew install syncthing
  echo "  Syncthing 安装完成"
fi

# 启动 Syncthing 作为 launchd 服务
if ! brew services list | grep syncthing | grep started &> /dev/null; then
  brew services start syncthing 2>/dev/null || true
  echo "  Syncthing 服务已启动"
fi

# ------ Step 6: 启动 Gateway ------
echo "[6/6] 安装并启动 Gateway..."
openclaw gateway stop 2>/dev/null || true
sleep 2
openclaw gateway install --force 2>/dev/null || true
openclaw gateway start

# ------ 完成 ------
echo ""
echo "========================================"
echo "  部署完成!"
echo "========================================"
echo ""
echo "  Agent: $AGENT_NAME"
echo "  Bot Token: ${BOT_TOKEN:0:10}..."
echo "  Gateway: http://127.0.0.1:$GATEWAY_PORT"
echo "  配置: $CONFIG_PATH"
echo ""
echo "  接下来还需要手动完成:"
echo "  1. 打开 Syncthing 界面: http://localhost:8384"
echo "  2. 添加 VPS 远程设备:"
echo "     Device ID: $VPS_SYNCTHING_ID"
echo "  3. 接受 VPS 的共享文件夹 (claw-shared, claw-fleet)"
echo "  4. 在 Telegram 群组里 @ 你的 bot 测试"
echo ""
