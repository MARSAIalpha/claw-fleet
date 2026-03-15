# Claw Dashboard 打包脚本
# 用法: .\build.ps1

$ErrorActionPreference = "Stop"

Write-Host "🦞 构建 Claw Dashboard..." -ForegroundColor Cyan

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "安装 Node.js..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:PATH = "$env:ProgramFiles\nodejs;$env:PATH"
}

# 安装依赖
Write-Host "安装依赖..." -ForegroundColor Yellow
npm install

# 构建
Write-Host "打包成 EXE..." -ForegroundColor Yellow
npm run build

Write-Host ""
Write-Host "✅ 完成！EXE 文件在 dist/ClawDashboard.exe" -ForegroundColor Green
Write-Host ""

# 打开输出目录
explorer dist
