# 小龙虾舰队 (claw-fleet) 项目说明

## 项目概述
多机器 AI Agent 舰队管理系统，基于 OpenClaw 运行时，通过 Syncthing + Tailscale 实现跨机器同步和通信。

## ⚠️ 开发工作流（重要）

**这个文件夹（claw-fleet）通过 Syncthing 实时同步到所有机器。**
直接在这里改代码 = 立刻推送到所有机器。

### 正确的开发方式：在独立目录开发，改好再部署

**第一次设置（Rog 上运行）：**
```powershell
# 克隆一份到 Syncthing 管理范围之外
git clone C:\Users\Rog\claw-fleet C:\dev\claw-fleet-dev
cd C:\dev\claw-fleet-dev
claude   # 在这里工作，不会同步到任何机器
```

**Mac 上：**
```bash
git clone ~/claw-fleet ~/dev/claw-fleet-dev
cd ~/dev/claw-fleet-dev
claude
```

**改完测好之后，部署到正式目录：**
```powershell
# Windows - 复制单个文件
copy C:\dev\claw-fleet-dev\monitor\heartbeat.js C:\Users\Rog\claw-fleet\monitor\heartbeat.js

# 或整个目录同步（排除 .git 和 shared）
robocopy C:\dev\claw-fleet-dev C:\Users\Rog\claw-fleet /E /XD .git shared node_modules
```

**Mac/Linux：**
```bash
cp ~/dev/claw-fleet-dev/monitor/heartbeat.js ~/claw-fleet/monitor/heartbeat.js
```

复制进正式目录后，Syncthing 自动同步到所有机器。然后用 fleet-updater 重启心跳：
```bash
node monitor/fleet-updater.js   # 全部机器
node monitor/fleet-updater.js --only rog,p4   # 指定机器
```

---

## 目录结构
```
claw-fleet/
├── monitor/
│   ├── heartbeat.js       # 心跳脚本（每台机器运行），当前 v6
│   ├── fleet-updater.js   # 批量更新工具（从 Rog 运行）
│   ├── fleet-watchdog.js  # 新版守护犬（VPS 上运行，HTTP 通知 dashboard）
│   └── watchdog.js        # 旧版守护犬（仅 Telegram 告警）
├── dashboard/
│   └── server.js          # Web 控制面板，端口 3000
├── dashboard-electron/    # Electron 桌面版 dashboard
├── service/               # 各平台安装/启动脚本
├── shared/
│   ├── heartbeats/        # 各机器心跳文件 {agent-id}.json（不在 git 里）
│   ├── memory/            # 各机器记忆文件
│   └── souls/             # Agent 人格文件
├── fleet-config.json      # 主配置（含 bot_token，不在 git 里！）
├── fleet-config.example.json  # 脱敏配置模板
├── CLAUDE.md              # 本文件
├── SESSION-LOG.md         # 开发会话日志
└── ONBOARDING.md          # 新机器入职流程
```

## 机器清单
| 机器 | agent_id | 系统 | Tailscale IP | 说明 |
|------|----------|------|-------------|------|
| Rog  | rog | Windows | 100.124.216.19 | 主控机，运行 dashboard |
| P4   | p4 | Windows | 100.79.7.113 | 工作站 |
| 4090 | 4090 | Windows | 100.110.240.106 | GPU 工作站 |
| MacBook | simondemacbook-air-7 | macOS | 100.87.148.50 | 笔记本 |
| Mac Mini 1 | macmini | macOS | 100.71.187.72 | - |
| Mac Mini 2 | macmini2 | macOS | 100.89.205.40 | - |
| VPS | vps | Linux | 100.72.3.74 | 守护犬节点（hidden，不显示在 dashboard）|

## 关键技术细节
- **OpenClaw 配置键**：用 camelCase，如 `channels.telegram.botToken`（不是 bot_token）
- **groupPolicy**：必须设为 `open` 才能回复群消息
- **心跳版本**：当前 HEARTBEAT_VERSION = 6，dashboard LATEST_HEARTBEAT_VERSION = 6
- **命令端口**：每台机器 heartbeat 开放 18790 端口接收远程命令
- **Dashboard 远程命令**：优先用 Tailscale IP（跨网段可达），local_ip 仅作兜底
- **Syncthing**：同步代码文件，但不重启进程，需手动或通过 restart-heartbeat 命令重载
- **Tailscale VPN**：所有机器在 100.x.x.x 网段
- **telegram_reachable**：heartbeat v6 新增字段，TCP 检测 api.telegram.org:443，dashboard 显示 "TG断连"
- **fleet-config.json**：含真实 bot_token 和 Tailscale IP，**绝对不能提交到 GitHub**

## 常用命令

### 启动 Dashboard（Rog 上运行）
```powershell
node C:\Users\Rog\claw-fleet\dashboard\server.js
```

### 重启 Dashboard（端口被占用时）
```powershell
Get-NetTCPConnection -LocalPort 3000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
node C:\Users\Rog\claw-fleet\dashboard\server.js
```

### 启动心跳（每台机器）
```powershell
# Windows (Rog)
node C:\Users\Rog\claw-fleet\monitor\heartbeat.js --agent-id rog --config C:\Users\Rog\claw-fleet\fleet-config.json
```
```bash
# Mac/Linux
node ~/claw-fleet/monitor/heartbeat.js --agent-id macmini --config ~/claw-fleet/fleet-config.json
```

### 批量更新所有机器
```bash
node monitor/fleet-updater.js
```

### 远程重启某台机器心跳（让新代码生效）
```bash
node monitor/fleet-updater.js --only macmini,macmini2
```

### 只重启心跳，不更新 OpenClaw
```bash
node monitor/fleet-updater.js --skip-openclaw-update
```

---

## 当前待办事项（2026-03-15）

### 高优先级
- **修复 MacBook**: 心跳进程挂了（96% 内存），需在 MacBook 上手动重启:
  ```bash
  pkill -f "heartbeat.js"
  cd ~/claw-fleet/monitor
  nohup node heartbeat.js --agent-id simondemacbook-air-7 --config ~/claw-fleet/fleet-config.json &
  bash ~/claw-fleet/service/install-heartbeat-mac.sh --agent-id simondemacbook-air-7
  ```
- **Dashboard SSH fallback**: 当 HTTP 18790 不通时（心跳挂了），通过 Tailscale SSH 远程重启
  - 需先验证: 在 Rog 上测试 `tailscale ssh simon@100.87.148.50 "echo hello"`
  - 验证通过后，在 dashboard 的 `executeRemoteCommand` 加 SSH fallback

### 中优先级
- **P4 和 4090 升级到 v6**: 目前还在 v5，缺少 telegram_reachable 检测
  - 运行 `node monitor/fleet-updater.js --only p4,4090`
- **VPS 心跳升级**: 运行旧版心跳，无版本号
- **所有 Mac 安装 launchd 服务**: 防止心跳进程崩溃后无法自动恢复
  ```bash
  bash ~/claw-fleet/service/install-heartbeat-mac.sh --agent-id <agent-id>
  ```
- **Windows 机器改用 Windows Service**: 当前用 Startup 文件夹启动，崩溃不会自动重启

### 低优先级
- 清理 Syncthing 冲突文件
- Dashboard Electron 桌面版完善
- ONBOARDING.md 新机器入职文档完善
- 推送到 GitHub（在 Rog 上执行 `git push origin main`）

---

## 当前已知问题
- **Mac Mini 1/2 TG断连**：api.telegram.org 被 GFW 封锁，需在每台 Mac 上开启 Clash Verge TUN 模式
- **心跳挂了 dashboard 无法远程重启**：heartbeat 进程死后 18790 端口消失，dashboard 命令不通。需要 SSH fallback 或系统级自动重启（launchd/systemd）
- **Syncthing 冲突文件**：shared/heartbeats/ 和 monitor/ 下有 *.sync-conflict-* 垃圾文件，可安全删除

## fleet-config.json 结构（敏感字段已脱敏）
```json
{
  "machines": {
    "rog":      { "agent_id": "rog",      "label": "Rog",        "tailscale_ip": "100.x.x.x", "bot_token": "..." },
    "p4":       { "agent_id": "p4",       "label": "P4",         "tailscale_ip": "100.x.x.x", "bot_token": "..." },
    "4090":     { "agent_id": "4090",     "label": "4090",       "tailscale_ip": "100.x.x.x", "bot_token": "..." },
    "macmini":  { "agent_id": "macmini",  "label": "Mac Mini 1", "tailscale_ip": "100.x.x.x", "bot_token": "..." },
    "macbook":  { "agent_id": "simondemacbook-air-7", "label": "MacBook", "tailscale_ip": "100.x.x.x", "bot_token": "..." },
    "macmini2": { "agent_id": "macmini2", "label": "Mac Mini 2", "tailscale_ip": "100.x.x.x", "bot_token": "..." },
    "vps":      { "agent_id": "vps",      "label": "VPS",        "tailscale_ip": "100.x.x.x", "bot_token": "...", "hidden": true }
  },
  "fleet": { "telegram": { "group_id": "...", "topics": { "日志": "..." } } }
}
```

## 版本历史
| 版本 | 主要变更 |
|------|---------|
| v6 | 新增 `telegram_reachable` TCP 检测，dashboard 四状态显示，botToken camelCase 修正，Mac/Linux 路径查找，groupPolicy auto-open，dashboard 远程命令改用 Tailscale IP 优先 |
| v5 | 新增 `findOpenClawPath()` 解决 Windows PATH 问题，修复 config-set，加 restart-heartbeat 命令 |
| v4 | 双阶段 fleet-updater，AJAX 无刷新 dashboard |
| v3 | HB版本列，dashboard 过滤 hidden 机器 |
