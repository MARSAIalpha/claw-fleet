# install-heartbeat-win.ps1
# 在 Windows 电脑上一键安装心跳服务（开机自启动）
# 不需要管理员权限！使用启动文件夹方式。
#
# 用法: .\install-heartbeat-win.ps1 -AgentId "rog"
# 卸载: .\install-heartbeat-win.ps1 -Uninstall

param(
    [string]$AgentId = "",
    [int]$Interval = 30,
    [switch]$Uninstall
)

$ErrorActionPreference = "Continue"

# ── 定位 claw-fleet 目录 ──
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$FleetDir = Split-Path -Parent $ScriptDir
if (-not (Test-Path "$FleetDir\monitor\heartbeat.js")) {
    $FleetDir = "$env:USERPROFILE\claw-fleet"
}
$HeartbeatScript = "$FleetDir\monitor\heartbeat.js"
$StatusFile = "$FleetDir\shared\fleet-status.json"
$ServiceDir = "$FleetDir\service"

# 启动文件夹路径
$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = "$StartupFolder\ClawFleetHeartbeat.lnk"
$VbsPath = "$ServiceDir\start-heartbeat.vbs"
$BatPath = "$ServiceDir\start-heartbeat.bat"

# ── 卸载 ──
if ($Uninstall) {
    Write-Host "[*] Removing heartbeat auto-start..." -ForegroundColor Yellow
    # 清理启动文件夹
    Remove-Item -Path $ShortcutPath -Force -ErrorAction SilentlyContinue
    # 清理旧的计划任务（如果有）
    Unregister-ScheduledTask -TaskName "ClawFleetHeartbeat" -Confirm:$false -ErrorAction SilentlyContinue
    # 停止正在运行的进程
    Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -like "*heartbeat*"
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Heartbeat removed." -ForegroundColor Green
    exit 0
}

# ── 检查 ──
if (-not $AgentId) {
    $AgentId = $env:COMPUTERNAME.ToLower()
    Write-Host "[*] No -AgentId, using hostname: $AgentId" -ForegroundColor Yellow
}

if (-not (Test-Path $HeartbeatScript)) {
    Write-Host "[ERROR] heartbeat.js not found: $HeartbeatScript" -ForegroundColor Red
    exit 1
}

try {
    $nodeVer = & node --version 2>&1
    Write-Host "[OK] Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js not found." -ForegroundColor Red
    exit 1
}

# 确保 shared 目录存在
$sharedDir = Split-Path -Parent $StatusFile
if (-not (Test-Path $sharedDir)) {
    New-Item -ItemType Directory -Path $sharedDir -Force | Out-Null
}

# ── 创建 bat 启动脚本 ──
@"
@echo off
cd /d "$($FleetDir)\monitor"
node heartbeat.js --agent-id "$AgentId" --interval $Interval --status-file "$StatusFile"
"@ | Out-File -Encoding ascii $BatPath

# ── 创建 vbs 静默启动脚本（不弹黑窗） ──
@"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "$BatPath" & chr(34), 0, False
Set WshShell = Nothing
"@ | Out-File -Encoding ascii $VbsPath

Write-Host "[OK] Created launcher scripts" -ForegroundColor Green

# ── 放入启动文件夹（创建快捷方式） ──
# 先清理旧的
Remove-Item -Path $ShortcutPath -Force -ErrorAction SilentlyContinue

$WScriptShell = New-Object -ComObject WScript.Shell
$Shortcut = $WScriptShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$VbsPath`""
$Shortcut.WorkingDirectory = $ServiceDir
$Shortcut.Description = "Claw Fleet Heartbeat - $AgentId"
$Shortcut.Save()

Write-Host "[OK] Added to Startup folder" -ForegroundColor Green
Write-Host "     $ShortcutPath" -ForegroundColor DarkGray

# ── 立即启动 ──
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Heartbeat installed!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Agent ID  : $AgentId"
Write-Host "  Interval  : ${Interval}s"
Write-Host "  Status    : $StatusFile"
Write-Host "  Auto-start: Startup folder (no admin needed)"
Write-Host ""
Write-Host "  Starting now..." -ForegroundColor Green

# 先杀掉可能存在的旧 heartbeat 进程
$existingProcs = Get-WmiObject Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*heartbeat*" }
foreach ($proc in $existingProcs) {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

# 启动
Start-Process -FilePath "wscript.exe" -ArgumentList "`"$VbsPath`"" -WindowStyle Hidden

Start-Sleep -Seconds 3

# 验证
if (Test-Path $StatusFile) {
    $content = Get-Content $StatusFile -Raw | ConvertFrom-Json
    if ($content.$AgentId) {
        Write-Host "  [OK] Heartbeat is running! Status file updated." -ForegroundColor Green
    } else {
        Write-Host "  [WARN] Status file exists but no data for '$AgentId' yet. Wait a moment..." -ForegroundColor Yellow
    }
} else {
    Write-Host "  [WARN] Status file not created yet. Check:" -ForegroundColor Yellow
    Write-Host "         node $HeartbeatScript --agent-id $AgentId --interval $Interval" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Next login: heartbeat auto-starts silently." -ForegroundColor Green
Write-Host "  Uninstall:  .\install-heartbeat-win.ps1 -Uninstall" -ForegroundColor DarkGray
