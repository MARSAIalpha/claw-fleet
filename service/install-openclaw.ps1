# ─────────────────────────────────────────────
# OpenClaw 安装/更新脚本 (Windows PowerShell)
# 使用 npm 全局安装，支持自动更新
#
# 用法:
#   .\install-openclaw.ps1              # 安装或更新
#   .\install-openclaw.ps1 -Check       # 只检查版本
# ─────────────────────────────────────────────

param(
    [switch]$Check
)

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  OpenClaw 安装 / 更新" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

# 检查 Node.js
$nodeVer = & node -v 2>$null
if (-not $nodeVer) {
    Write-Host "[ERROR] Node.js 未安装" -ForegroundColor Red
    Write-Host "请先安装 Node.js v18+: https://nodejs.org/"
    exit 1
}
Write-Host "Node.js: $nodeVer" -ForegroundColor Green

# 检查 npm
$npmVer = & npm -v 2>$null
if (-not $npmVer) {
    Write-Host "[ERROR] npm 未安装" -ForegroundColor Red
    exit 1
}
Write-Host "npm:     $npmVer" -ForegroundColor Green

# 检查当前版本
$current = ""
try {
    $current = & openclaw --version 2>$null
    Write-Host "当前版本: $current" -ForegroundColor Yellow
} catch {
    Write-Host "当前版本: 未安装" -ForegroundColor Red
}

# 查询最新版本
Write-Host ""
Write-Host "正在查询 npm 最新版本..."
$latest = & npm view openclaw version 2>$null
Write-Host "最新版本: $latest" -ForegroundColor Green

if ($Check) {
    if ($current -match [regex]::Escape($latest)) {
        Write-Host "`n已是最新版本" -ForegroundColor Green
    } else {
        Write-Host "`n有新版本可用！运行此脚本（不带 -Check）来更新" -ForegroundColor Yellow
    }
    exit 0
}

# 安装/更新
Write-Host ""
Write-Host "正在安装 openclaw@latest..."
& npm install -g openclaw@latest

# 验证
Write-Host ""
$newVer = & openclaw --version 2>$null
Write-Host "安装后版本: $newVer" -ForegroundColor Green

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "  完成！" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""
