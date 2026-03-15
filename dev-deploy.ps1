# dev-deploy.ps1
# 把开发目录的代码同步到正式 claw-fleet 目录（触发 Syncthing 同步到所有机器）
# 用法：在 C:\dev\claw-fleet-dev 里运行 .\dev-deploy.ps1

$DEV_DIR   = "C:\dev\claw-fleet-dev"
$PROD_DIR  = "C:\Users\Rog\claw-fleet"

# 只同步代码文件，不动 shared（心跳数据）和 fleet-config.json（敏感配置）
$excludeDirs  = @(".git", "shared", "node_modules", "tmp")
$excludeFiles = @("fleet-config.json", "*.sync-conflict-*", "nohup.out", "*.log")

Write-Host "🦞 部署到正式目录..." -ForegroundColor Cyan
Write-Host "  从: $DEV_DIR" -ForegroundColor Gray
Write-Host "  到: $PROD_DIR" -ForegroundColor Gray

$exDirArgs  = $excludeDirs  | ForEach-Object { "/XD", $_ }
$exFileArgs = $excludeFiles | ForEach-Object { "/XF", $_ }

robocopy $DEV_DIR $PROD_DIR /E /MIR @exDirArgs @exFileArgs /NJH /NJS

Write-Host "✅ 同步完成，Syncthing 将自动推送到所有机器" -ForegroundColor Green
Write-Host ""
Write-Host "如需立即重启心跳，运行：" -ForegroundColor Yellow
Write-Host "  cd $PROD_DIR && node monitor\fleet-updater.js" -ForegroundColor Gray
