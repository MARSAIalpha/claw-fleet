# ═══════════════════════════════════════════════════════
# 小龙虾节点一键部署脚本 (Windows PowerShell)
#
# 用法（以管理员身份运行 PowerShell）:
#   .\node-setup.ps1 -AgentId writer -BotToken "YOUR_BOT_TOKEN"
#
# 此脚本会：
#   1. 检查并安装依赖（Node.js, OpenClaw, Syncthing）
#   2. 从共享文件夹读取配置，自动生成 openclaw.json
#   3. 注册 Windows 计划任务实现自启动 + 崩溃重启
#   4. 启动心跳监控
# ═══════════════════════════════════════════════════════

param(
    [Parameter(Mandatory=$true)]
    [string]$AgentId,

    [string]$BotToken = "",
    [string]$SharedDir = "$env:USERPROFILE\claw-shared",
    [string]$WorkspaceBase = "$env:USERPROFILE\openclaw"
)

$ErrorActionPreference = "Stop"

Write-Host "`n🦞 小龙虾节点部署脚本 v1.0 (Windows)" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Agent ID: $AgentId" -ForegroundColor Green
Write-Host "共享目录: $SharedDir" -ForegroundColor Green
Write-Host "工作目录: $WorkspaceBase\$AgentId-workspace`n" -ForegroundColor Green

# ══════ 1. 检查依赖 ══════
Write-Host "[1/6] 检查依赖..." -ForegroundColor Yellow

# Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  安装 Node.js..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:PATH = "$env:ProgramFiles\nodejs;$env:PATH"
}
Write-Host "  Node.js: $(node -v) ✓" -ForegroundColor Green

# OpenClaw
if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {
    Write-Host "  安装 OpenClaw..."
    npm install -g openclaw
}
Write-Host "  OpenClaw: installed ✓" -ForegroundColor Green

# Syncthing
if (-not (Get-Command syncthing -ErrorAction SilentlyContinue)) {
    Write-Host "  安装 Syncthing..."
    winget install Syncthing.Syncthing --accept-package-agreements --accept-source-agreements
}
Write-Host "  Syncthing: installed ✓" -ForegroundColor Green

# ══════ 2. 创建目录结构 ══════
Write-Host "[2/6] 创建目录结构..." -ForegroundColor Yellow

$Workspace = "$WorkspaceBase\$AgentId-workspace"
New-Item -ItemType Directory -Force -Path $Workspace | Out-Null
$dirs = @("context", "素材库", "剧本", "分镜", "视频", "数据", "任务队列")
foreach ($d in $dirs) {
    New-Item -ItemType Directory -Force -Path "$SharedDir\$d" | Out-Null
}
Write-Host "  工作区: $Workspace ✓" -ForegroundColor Green
Write-Host "  共享区: $SharedDir ✓" -ForegroundColor Green

# ══════ 3. 生成 OpenClaw 配置 ══════
Write-Host "[3/6] 生成 OpenClaw 配置..." -ForegroundColor Yellow

$FleetConfig = "$WorkspaceBase\claw-fleet\fleet-config.json"
$AgentName = $AgentId
$AgentModel = "deepseek/deepseek-chat"
$GroupId = "-100XXXXXXXXXX"

if (Test-Path $FleetConfig) {
    Write-Host "  从 fleet-config.json 读取配置..."
    $config = Get-Content $FleetConfig | ConvertFrom-Json
    $agentConf = $config.agents | Where-Object { $_.id -eq $AgentId }
    if ($agentConf) {
        $AgentName = $agentConf.name
        $AgentModel = $agentConf.model
    }
    $GroupId = $config.fleet.telegram.group_id
}

if ([string]::IsNullOrEmpty($BotToken)) {
    $envVar = "CLAW_BOT_TOKEN_$($AgentId.ToUpper())"
    $BotToken = [Environment]::GetEnvironmentVariable($envVar, "User")
    if ([string]::IsNullOrEmpty($BotToken)) {
        Write-Host "  警告: 未提供 Bot Token，请稍后手动配置" -ForegroundColor Yellow
        $BotToken = "YOUR_BOT_TOKEN_HERE"
    }
}

$openclawJson = @"
{
  "`$schema": "https://openclaw.ai/schemas/openclaw.json",
  "name": "$AgentName",
  "agents": [
    {
      "id": "$AgentId",
      "name": "$AgentName",
      "model": "$AgentModel",
      "workspace": "."
    }
  ],
  "channels": {
    "telegram": {
      "bots": [
        {
          "token": "$BotToken",
          "agents": {
            "$AgentId": {
              "groups": {
                "$GroupId": {
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
"@

Set-Content -Path "$Workspace\openclaw.json" -Value $openclawJson -Encoding UTF8
Write-Host "  openclaw.json 已生成 ✓" -ForegroundColor Green

# ══════ 4. 复制 Soul 和 Skills ══════
Write-Host "[4/6] 配置 Soul 和 Skills..." -ForegroundColor Yellow

$soulSource = "$WorkspaceBase\claw-fleet\shared\souls\$AgentId.md"
if (Test-Path $soulSource) {
    Copy-Item $soulSource "$Workspace\soul.md"
    Write-Host "  soul.md 已复制 ✓" -ForegroundColor Green
} else {
    $defaultSoul = @"
# $AgentName

你是 Simon AI 团队的 $AgentName。

## 职责
请根据任务指令完成工作，完成后在 Telegram 群组汇报。

## 协作规则
- 文件产出保存到共享文件夹: $SharedDir
- 完成任务后通知主控虾
- 遇到问题及时上报
"@
    Set-Content -Path "$Workspace\soul.md" -Value $defaultSoul -Encoding UTF8
    Write-Host "  已生成默认 soul.md" -ForegroundColor Yellow
}

# Skills 符号链接
$skillsSource = "$WorkspaceBase\claw-fleet\shared\skills"
if (Test-Path $skillsSource) {
    $skillsTarget = "$Workspace\skills"
    if (-not (Test-Path $skillsTarget)) {
        cmd /c mklink /D "$skillsTarget" "$skillsSource" | Out-Null
    }
    Write-Host "  Skills 已链接 ✓" -ForegroundColor Green
}

# ══════ 5. 注册 Windows 计划任务 ══════
Write-Host "[5/6] 注册自启动服务..." -ForegroundColor Yellow

$taskName = "OpenClaw-$AgentId"

# 删除旧任务（如果存在）
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# OpenClaw Gateway 任务
$action = New-ScheduledTaskAction `
    -Execute "openclaw" `
    -Argument "gateway" `
    -WorkingDirectory $Workspace

$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Seconds 30) `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "OpenClaw Agent: $AgentName" | Out-Null

Write-Host "  Windows 计划任务已注册 ✓" -ForegroundColor Green
Write-Host "  进程崩溃后每30秒自动重启"

# 心跳任务
$heartbeatTask = "ClawHeartbeat-$AgentId"
Unregister-ScheduledTask -TaskName $heartbeatTask -Confirm:$false -ErrorAction SilentlyContinue

$hbAction = New-ScheduledTaskAction `
    -Execute "node" `
    -Argument "$WorkspaceBase\claw-fleet\monitor\heartbeat.js --agent-id $AgentId --interval 300" `
    -WorkingDirectory "$WorkspaceBase\claw-fleet\monitor"

Register-ScheduledTask `
    -TaskName $heartbeatTask `
    -Action $hbAction `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Heartbeat monitor for $AgentName" | Out-Null

Write-Host "  心跳监控任务已注册 ✓" -ForegroundColor Green

# ══════ 6. 完成 ══════
Write-Host "`n════════════════════════════════════════" -ForegroundColor Green
Write-Host "🦞 $AgentName 节点部署完成！" -ForegroundColor Green
Write-Host "════════════════════════════════════════`n" -ForegroundColor Green

Write-Host "工作目录:  $Workspace"
Write-Host "配置文件:  $Workspace\openclaw.json"
Write-Host "角色定义:  $Workspace\soul.md"
Write-Host ""
Write-Host "后续步骤:" -ForegroundColor Yellow
Write-Host "  1. 确认 Bot Token 已正确配置"
Write-Host "  2. 确认 Syncthing 已连接到 VPS"
Write-Host "  3. 启动:"
Write-Host "     cd $Workspace; openclaw gateway"
Write-Host "  4. 或启动计划任务:"
Write-Host "     Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "管理命令:" -ForegroundColor Cyan
Write-Host "  查看状态:    Get-ScheduledTask -TaskName '$taskName'"
Write-Host "  启动服务:    Start-ScheduledTask -TaskName '$taskName'"
Write-Host "  停止服务:    Stop-ScheduledTask -TaskName '$taskName'"
Write-Host "  查看日志:    Get-Content -Tail 50 '$Workspace\gateway.log'"
Write-Host "  更新配置:    从 Syncthing 同步后自动生效"
