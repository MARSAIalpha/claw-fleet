# 开发会话日志

> 最后更新: 2026-03-15
> 目的: 记录开发上下文，方便在另一台电脑上继续工作

## 当前系统状态

### 机器状态 (截至 2026-03-15 17:23 UTC+8)
| 机器 | agent_id | HB版本 | 状态 | 说明 |
|------|----------|--------|------|------|
| Rog | rog | v6 | 在线，TG✓ | 主控机，运行 dashboard |
| P4 | p4 | v5 | 在线 | 需升级到 v6 |
| 4090 | 4090 | v5 | 在线 | 需升级到 v6 |
| Mac Mini 1 | macmini | v6 | 在线，TG✓ | 正常 |
| MacBook | simondemacbook-air-7 | v5 | 离线 | 心跳进程挂了，需手动重启 |
| Mac Mini 2 | macmini2 | - | 关机 | 物理关机状态 |
| VPS | vps | 旧版 | 在线 | 守护犬节点，需升级 |

### 心跳版本
- 当前最新: HEARTBEAT_VERSION = 6 (heartbeat.js), LATEST_HEARTBEAT_VERSION = 6 (dashboard)
- v6 新增: `telegram_reachable` 字段 (TCP 检测 api.telegram.org:443)
- v6 新增: Mac/Linux 的 `findOpenClawPath()` 路径查找
- v6 修复: `bot_token` → `botToken` (camelCase)
- v6 新增: 自动设置 `groupPolicy open`
- v6 新增: Mac/Linux 命令执行时补全 PATH 环境变量

## 本次会话完成的工作

### 1. heartbeat.js v5 → v6 升级
- 新增 `checkTelegramReachable()` — TCP 连通检测 api.telegram.org:443
- `heartbeat()` 改为 async，新增 `telegram_reachable` 字段 (true/false/null)
- `findOpenClawPath()` 补了 Mac/Linux 路径查找逻辑
- 所有 `bot_token` 改为 `botToken` (OpenClaw camelCase 规范)
- 命令端口 exec 补了 Mac/Linux 的 PATH 环境变量
- 自动配置时强制 `groupPolicy open`

### 2. dashboard/server.js 升级
- `LATEST_HEARTBEAT_VERSION` 5 → 6
- 新增 TG断连 状态显示 (四状态: 运行中/TG断连/GW停止/离线)
- `onlineCount` 排除 TG 断连的机器
- 异常计数包含 `tgBlockedCount`
- **修复 IP 优先级 bug**: `executeRemoteCommand` 改为优先用 `tailscale_ip` 而非 `local_ip`
  - 原因: Rog 和 Mac 不在同一局域网，local_ip (192.168.31.x) 不可达
  - 改后: tailscale_ip (100.x.x.x) > local_ip

### 3. fleet-updater.js
- `bot_token` → `botToken` 修正

### 4. 开发工作流建立
- 创建 dev-deploy.ps1 / dev-deploy.sh 部署脚本
- 写好 CLAUDE.md 项目文档和开发规范
- 建议在 Syncthing 外的独立目录开发 (`C:\dev\claw-fleet-dev`)

### 5. 安全处理
- fleet-config.json 从 git 追踪中移除 (含真实 bot_token)
- 创建 fleet-config.example.json 脱敏模板
- .gitignore 更新，排除 heartbeat 数据、日志、临时文件

## 待办事项 (TODO)

### 高优先级
- [ ] **修复 MacBook**: 心跳进程挂了 (96% 内存)，需在 MacBook 上手动重启:
  ```bash
  pkill -f "heartbeat.js"
  cd ~/claw-fleet/monitor
  nohup node heartbeat.js --agent-id simondemacbook-air-7 --config ~/claw-fleet/fleet-config.json &
  bash ~/claw-fleet/service/install-heartbeat-mac.sh --agent-id simondemacbook-air-7
  ```
- [ ] **Dashboard SSH fallback**: 当 HTTP 18790 不通时，通过 Tailscale SSH 远程重启
  - 需先验证: 在 Rog 上测试 `tailscale ssh simon@100.87.148.50 "echo hello"`
  - 如果通了，在 dashboard 的 `executeRemoteCommand` 加 SSH fallback 逻辑

### 中优先级
- [ ] **P4 和 4090 升级到 v6**: 目前还在 v5，缺少 telegram_reachable 检测
  - 运行 `node monitor/fleet-updater.js --only p4,4090` 或等 Syncthing 同步后手动重启心跳
- [ ] **VPS 心跳升级**: 运行旧版心跳，无版本号
- [ ] **所有 Mac 安装 launchd 服务**: 防止心跳进程崩溃后无法自动恢复
  ```bash
  bash ~/claw-fleet/service/install-heartbeat-mac.sh --agent-id <agent-id>
  ```
- [ ] **Windows 机器改用 Windows Service**: 当前用 Startup 文件夹启动，崩溃不会自动重启

### 低优先级
- [ ] 清理 Syncthing 冲突文件 (shared/heartbeats/ 和 monitor/ 下的 *.sync-conflict-*)
- [ ] Dashboard Electron 桌面版完善
- [ ] ONBOARDING.md 新机器入职文档完善

## 架构要点 (给下一个开发会话的提示)

1. **不要直接在 claw-fleet/ 目录改代码** — Syncthing 会立刻同步到所有机器
2. **OpenClaw 配置用 camelCase**: `channels.telegram.botToken`, 不是 `bot_token`
3. **groupPolicy 必须设为 open** 才能回复群消息
4. **命令端口 18790**: 每台机器的 heartbeat 开放此端口接收远程命令
5. **Watchdog 只能重启 Gateway，不能重启心跳进程本身**
6. **Mac Mini 1/2 的 TG 被墙**: 需开启 Clash Verge TUN 模式
7. **fleet-config.json 含真实 token**: 绝对不能提交到 GitHub

## 关键文件路径
- 心跳脚本: `monitor/heartbeat.js` (v6)
- Dashboard: `dashboard/server.js` (LATEST_HEARTBEAT_VERSION = 6)
- 批量更新: `monitor/fleet-updater.js`
- 守护犬: `monitor/fleet-watchdog.js` (VPS 上运行)
- 舰队配置: `fleet-config.json` (不在 git 里，通过 Syncthing 同步)
- 心跳数据: `shared/heartbeats/{agent-id}.json`
- Mac 服务安装: `service/install-heartbeat-mac.sh`
- Windows 启动: `service/start-heartbeat.bat` + `start-heartbeat.vbs`
