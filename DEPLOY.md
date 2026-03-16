# 小龙虾舰队部署指南

## 前提条件（每台机器都需要）
1. **Node.js** (v18+): `node --version`
2. **Tailscale** 已登录: `tailscale status`
3. **Syncthing** 已配置共享 `claw-fleet` 文件夹
4. **OpenClaw** 已安装并配置
5. **SSH 服务** 已开启（总控虾通过 SSH 调度各机器）

## 快速验证当前状态

在 Rog 上执行：
```powershell
cd C:\Users\Rog\claw-fleet
node monitor\heartbeat.js --agent-id rog --interval 30 --status-file shared\fleet-status.json
# Ctrl+C 停止，检查输出
type shared\fleet-status.json
```

启动控制面板：
```powershell
cd C:\Users\Rog\claw-fleet\dashboard
set DASHBOARD_PORT=4567
node server.js
# 访问 http://localhost:4567
```

---

## 各机器部署步骤

### 1. Rog (Windows) ✅ 已完成
```powershell
cd C:\Users\Rog\claw-fleet\service
.\install-heartbeat-win.ps1 -AgentId "rog"
```

### 2. VPS (Linux / ali-vps)
```bash
# SSH 到 VPS
tailscale ssh root@100.72.3.74

# 确认 claw-fleet 已通过 Syncthing 同步
ls ~/claw-fleet/monitor/heartbeat.js

# 安装心跳服务
sudo bash ~/claw-fleet/service/install-heartbeat-linux.sh --agent-id vps

# 检查服务状态
systemctl status claw-heartbeat

# 可选：在 VPS 上也跑 dashboard（推荐，让所有机器都能访问）
cd ~/claw-fleet/dashboard
DASHBOARD_PORT=4567 nohup node server.js > dashboard.log 2>&1 &
```

### 3. Mac Mini (macOS)
```bash
# 先配置 fleet-config.json 里的 macmini 信息
# 然后安装
bash ~/claw-fleet/service/install-heartbeat-mac.sh --agent-id macmini

# 检查
launchctl list | grep claw
```

### 4. MacBook (macOS)
```bash
bash ~/claw-fleet/service/install-heartbeat-mac.sh --agent-id macbook
```

### 5. P4 工作站 (Windows)
```powershell
cd C:\Users\<USERNAME>\claw-fleet\service
.\install-heartbeat-win.ps1 -AgentId "p4"
```

### 6. 4090 渲染机 (Windows)
```powershell
cd C:\Users\<USERNAME>\claw-fleet\service
.\install-heartbeat-win.ps1 -AgentId "4090"
```

### 7. Win Mini (Windows)
```powershell
cd C:\Users\<USERNAME>\claw-fleet\service
.\install-heartbeat-win.ps1 -AgentId "winmini"
```

---

## SSH 配置（舰队调度必需）

总控虾通过 SSH 调度其他机器上的 Agent。每台被调度的机器都需要开启 SSH 服务。

### macOS
系统设置 → 通用 → 共享 → 远程登录 → 开启

### Windows
```powershell
# 以管理员身份运行
Get-Service sshd | Start-Service
Set-Service -Name sshd -StartupType Automatic
```

### Linux
```bash
sudo systemctl enable --now sshd
```

### 验证 SSH 连通性
```bash
# 从总控虾机器（macbook）测试
ssh -o ConnectTimeout=3 <user>@<tailscale_ip> echo ok
```

Dashboard 会每 60 秒自动检测各机器的 SSH 连通性，在状态列显示绿色/红色 SSH 标签。

### 调度脚本
总控虾使用 `shared/skills/fleet-dispatch/dispatch.sh` 通过 SSH 调度任务：
```bash
bash ~/claw-fleet/shared/skills/fleet-dispatch/dispatch.sh <机器名> "<消息>"
```

---

## 部署后验证
在控制面板 http://localhost:4567 确认：
- 所有已部署机器显示绿色「运行中」
- 心跳时间在 2 分钟以内
- 模型配置和认证信息正确显示
- SSH 标签显示绿色（被调度的机器）

## 卸载
```bash
# Windows
.\install-heartbeat-win.ps1 -Uninstall

# macOS
bash install-heartbeat-mac.sh --uninstall

# Linux
sudo bash install-heartbeat-linux.sh --uninstall
```
