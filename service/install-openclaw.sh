#!/bin/bash
# ─────────────────────────────────────────────
# OpenClaw 安装/更新脚本 (Linux / macOS)
# 使用 npm 全局安装，支持自动更新
#
# 用法:
#   bash install-openclaw.sh              # 安装或更新
#   bash install-openclaw.sh --check      # 只检查版本
# ─────────────────────────────────────────────

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "═══════════════════════════════════════"
echo "  OpenClaw 安装 / 更新"
echo "═══════════════════════════════════════"
echo ""

# 检查 Node.js
if ! command -v node &>/dev/null; then
  echo -e "${RED}[ERROR] Node.js 未安装${NC}"
  echo "请先安装 Node.js v18+: https://nodejs.org/"
  exit 1
fi

NODE_VER=$(node -v)
echo -e "Node.js: ${GREEN}${NODE_VER}${NC}"

# 检查 npm
if ! command -v npm &>/dev/null; then
  echo -e "${RED}[ERROR] npm 未安装${NC}"
  exit 1
fi

NPM_VER=$(npm -v)
echo -e "npm:     ${GREEN}${NPM_VER}${NC}"

# 检查当前版本
CURRENT=""
if command -v openclaw &>/dev/null; then
  CURRENT=$(openclaw --version 2>/dev/null || echo "unknown")
  echo -e "当前版本: ${YELLOW}${CURRENT}${NC}"
else
  echo -e "当前版本: ${RED}未安装${NC}"
fi

# 查询最新版本
echo ""
echo "正在查询 npm 最新版本..."
LATEST=$(npm view openclaw version 2>/dev/null || echo "unknown")
echo -e "最新版本: ${GREEN}${LATEST}${NC}"

if [ "$1" = "--check" ]; then
  if echo "$CURRENT" | grep -q "$LATEST"; then
    echo -e "\n${GREEN}已是最新版本${NC}"
  else
    echo -e "\n${YELLOW}有新版本可用！运行此脚本（不带 --check）来更新${NC}"
  fi
  exit 0
fi

# 安装/更新
echo ""
echo "正在安装 openclaw@latest..."
npm install -g openclaw@latest

# 验证
echo ""
NEW_VER=$(openclaw --version 2>/dev/null || echo "安装失败")
echo -e "安装后版本: ${GREEN}${NEW_VER}${NC}"

echo ""
echo "═══════════════════════════════════════"
echo -e "  ${GREEN}完成！${NC}"
echo "═══════════════════════════════════════"
echo ""
