# ============================================================
# 小龙虾舰队 - Windows 一键部署脚本
# 用法: .\deploy-windows.ps1 -BotToken "你的BOT_TOKEN" -AgentName "虾的名字"
# 例如: .\deploy-windows.ps1 -BotToken "123:abc" -AgentName "视频虾"
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$BotToken,

    [Parameter(Mandatory=$true)]
    [string]$AgentName,

    [string]$OwnerTelegramId = "6346780385",
    [string]$GatewayPort = "18789",
    [string]$VpsSyncthingId = "PWQNFIY-CQ7OTI5-7Y676LP-3BAFQHL-3N5PCWW-3GCTDIJ-X7S3M25-YWXBQQ3",
    [string]$VpsIp = "122.152.215.102"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  小龙虾舰队 - 一键部署 (Windows)" -ForegroundColor Cyan
Write-Host "  Agent: $AgentName" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ------ Step 1: 检查并安装 Node.js ------
Write-Host "[1/6] 检查 Node.js..." -ForegroundColor Green
if (Get-Command node -ErrorAction SilentlyContinue) {
    $nodeVersion = node -v
    Write-Host "  Node.js 已安装: $nodeVersion" -ForegroundColor Gray
} else {
    Write-Host "  安装 Node.js..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Host "  Node.js 安装完成" -ForegroundColor Gray
}

# ------ Step 2: 安装 OpenClaw ------
Write-Host "[2/6] 检查 OpenClaw..." -ForegroundColor Green
if (Get-Command openclaw -ErrorAction SilentlyContinue) {
    Write-Host "  OpenClaw 已安装" -ForegroundColor Gray
} else {
    Write-Host "  安装 OpenClaw..." -ForegroundColor Yellow
    npm install -g openclaw@latest
    Write-Host "  OpenClaw 安装完成" -ForegroundColor Gray
}

# ------ Step 3: 生成 openclaw.json ------
Write-Host "[3/6] 生成配置文件..." -ForegroundColor Green
$openclawDir = "$env:USERPROFILE\.openclaw"
if (-not (Test-Path $openclawDir)) {
    New-Item -ItemType Directory -Path $openclawDir -Force | Out-Null
}

# 生成随机 gateway token
$gatewayToken = -join ((48..57) + (97..102) | Get-Random -Count 48 | ForEach-Object { [char]$_ })

$workspace = "$env:USERPROFILE\clawd" -replace '\\', '\\\\'
$openclawDirEscaped = $openclawDir -replace '\\', '\\\\'

$config = @"
{
  "meta": {
    "lastTouchedVersion": "2026.3.12",
    "lastTouchedAt": "$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffZ')"
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
      "workspace": "$workspace",
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
      "botToken": "$BotToken",
      "allowFrom": [$OwnerTelegramId],
      "groupPolicy": "open",
      "groups": {},
      "streaming": "partial"
    }
  },
  "gateway": {
    "port": $GatewayPort,
    "mode": "local",
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "$gatewayToken"
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
"@

# 备份已有配置
$configPath = "$openclawDir\openclaw.json"
if (Test-Path $configPath) {
    $backupPath = "$configPath.bak.deploy-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Copy-Item $configPath $backupPath
    Write-Host "  已备份原配置到: $backupPath" -ForegroundColor Gray
}

$config | Set-Content -Path $configPath -Encoding UTF8
Write-Host "  配置文件已生成: $configPath" -ForegroundColor Gray

# ------ Step 4: 创建工作目录 ------
Write-Host "[4/6] 创建工作目录..." -ForegroundColor Green
$dirs = @(
    "$env:USERPROFILE\clawd",
    "$env:USERPROFILE\claw-shared\新闻组",
    "$env:USERPROFILE\claw-shared\带货视频组",
    "$env:USERPROFILE\claw-shared\AI教程组",
    "$env:USERPROFILE\claw-shared\漫剧教程组",
    "$env:USERPROFILE\claw-shared\App开发组",
    "$env:USERPROFILE\claw-shared\公共资源",
    "$env:USERPROFILE\claw-fleet"
)
foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}
Write-Host "  工作目录已创建" -ForegroundColor Gray

# ------ Step 5: 安装 SyncTrayzor ------
Write-Host "[5/6] 检查 Syncthing (SyncTrayzor)..." -ForegroundColor Green
$syncTrayzorPath = "${env:ProgramFiles}\SyncTrayzor\SyncTrayzor.exe"
$syncTrayzorPath86 = "${env:ProgramFiles(x86)}\SyncTrayzor\SyncTrayzor.exe"
if ((Test-Path $syncTrayzorPath) -or (Test-Path $syncTrayzorPath86)) {
    Write-Host "  SyncTrayzor 已安装" -ForegroundColor Gray
} else {
    Write-Host "  安装 SyncTrayzor..." -ForegroundColor Yellow
    winget install SyncTrayzor.SyncTrayzor --accept-package-agreements --accept-source-agreements
    Write-Host "  SyncTrayzor 安装完成，请手动启动并添加 VPS 远程设备" -ForegroundColor Yellow
}

# ------ Step 6: 启动 Gateway ------
Write-Host "[6/6] 安装并启动 Gateway 服务..." -ForegroundColor Green
try {
    openclaw gateway install --force 2>$null
    Write-Host "  Gateway 服务已注册" -ForegroundColor Gray
} catch {
    Write-Host "  Gateway 服务注册跳过（可能已存在）" -ForegroundColor Gray
}

try {
    openclaw gateway stop 2>$null
    Start-Sleep -Seconds 2
} catch {}

openclaw gateway start
Write-Host "  Gateway 已启动" -ForegroundColor Gray

# ------ 完成 ------
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  部署完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Agent: $AgentName" -ForegroundColor Yellow
Write-Host "  Bot Token: $($BotToken.Substring(0,10))..." -ForegroundColor Gray
Write-Host "  Gateway: http://127.0.0.1:$GatewayPort" -ForegroundColor Gray
Write-Host "  配置: $configPath" -ForegroundColor Gray
Write-Host ""
Write-Host "  接下来还需要手动完成:" -ForegroundColor Cyan
Write-Host "  1. 启动 SyncTrayzor 并添加 VPS 远程设备:" -ForegroundColor White
Write-Host "     Device ID: $VpsSyncthingId" -ForegroundColor Gray
Write-Host "  2. 接受 VPS 的共享文件夹 (claw-shared, claw-fleet)" -ForegroundColor White
Write-Host "  3. 在 Telegram 群组里 @ 你的 bot 测试" -ForegroundColor White
Write-Host ""
