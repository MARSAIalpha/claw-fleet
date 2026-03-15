#!/bin/bash
# dev-deploy.sh
# 把开发目录的代码同步到正式 claw-fleet 目录（触发 Syncthing 同步到所有机器）
# 用法：在 ~/dev/claw-fleet-dev 里运行 ./dev-deploy.sh

DEV_DIR="$HOME/dev/claw-fleet-dev"
PROD_DIR="$HOME/claw-fleet"

echo "🦞 部署到正式目录..."
echo "  从: $DEV_DIR"
echo "  到: $PROD_DIR"

rsync -av --exclude='.git' \
          --exclude='shared/' \
          --exclude='node_modules/' \
          --exclude='tmp/' \
          --exclude='fleet-config.json' \
          --exclude='*.sync-conflict-*' \
          --exclude='nohup.out' \
          --exclude='*.log' \
          "$DEV_DIR/" "$PROD_DIR/"

echo ""
echo "✅ 同步完成，Syncthing 将自动推送到所有机器"
echo ""
echo "如需立即重启心跳，运行："
echo "  cd $PROD_DIR && node monitor/fleet-updater.js"
