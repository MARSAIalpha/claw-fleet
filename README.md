# Claw Fleet - Distributed AI Agent Fleet Manager

[English](#english) | [中文](#中文)

---

<a name="english"></a>

Manage multiple AI agents running across your physical machines — with heartbeat monitoring, remote control, auto-restart, and a web dashboard. Built for [OpenClaw](https://openclaw.ai) but the monitoring/management layer is framework-agnostic.

```
                    Tailscale VPN (100.x.x.x)
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   ┌────▼────┐       ┌────▼────┐       ┌────▼────┐
   │ Machine1 │       │ Machine2 │       │ Machine3 │
   │ Hub Agent│  SSH  │ Dev Agent│  SSH  │ News Bot │
   │ Heartbeat├──────►│ Heartbeat├──────►│ Heartbeat│
   │ :18790   │       │ :18790   │       │ :18790   │
   └────┬─────┘       └────┬─────┘       └────┬─────┘
        │                  │                  │
        │         Syncthing (file sync)       │
        │              ┌───┴───┐              │
        └──────────────┤  VPS  ├──────────────┘
                       │Watchdog│
                       └───┬───┘
                           │
                    ┌──────▼──────┐
                    │  Dashboard   │
                    │  :3000       │
                    └─────────────┘
```

## Why This Project Exists

There are many multi-agent frameworks (CrewAI, AutoGen, MetaGPT), but they all run on a **single machine**. If you have multiple computers at home or in an office and want each to run an AI agent with:

- Real-time health monitoring across all machines
- Remote restart/update without SSH-ing into each box
- Auto-restart when an agent crashes
- Cross-platform support (Windows, macOS, Linux)
- Zero cloud dependency (runs entirely on your LAN/VPN)
- Inter-agent communication via SSH dispatch (bots can't see each other on Telegram/Feishu)

...there's nothing out there that does this. **Claw Fleet** fills that gap.

## Features

| Feature | Description |
|---------|-------------|
| **Cross-platform heartbeat** | Single `heartbeat.js` runs on Win/Mac/Linux, reports CPU, memory, uptime, agent status every 60s |
| **Web dashboard** | Apple-style glass UI, real-time fleet overview, remote command execution |
| **4-state health indicator** | Green (running) / Yellow (agent up, Telegram blocked) / Red (agent down) / Gray (offline) |
| **Remote control** | Restart, stop, update agents without SSH — via HTTP API on port 18790 |
| **Auto-restart** | launchd (macOS), systemd (Linux), Startup folder (Windows) service installers |
| **Hot code reload** | Push code via Syncthing, then `restart-heartbeat` to reload without downtime |
| **Fleet updater** | Batch update all machines from a single command |
| **Watchdog** | Detects offline machines, auto-restarts crashed agents, sends Telegram alerts |
| **One-click onboarding** | `node-setup.sh` takes a fresh machine from zero to running agent |
| **Declarative config** | Single `fleet-config.json` defines all machines, agents, and channels |

## Quick Start

### 1. Prerequisites

All machines need:
- [Node.js](https://nodejs.org) v18+
- [Tailscale](https://tailscale.com) (free VPN mesh, all machines on same account)
- [Syncthing](https://syncthing.net) (file sync across machines)

### 2. Clone & Configure

```bash
git clone https://github.com/MARSAIalpha/claw-fleet.git
cd claw-fleet

# Copy the example config and fill in your values
cp fleet-config.example.json fleet-config.json
```

Edit `fleet-config.json`:
```json
{
  "machines": {
    "my-pc": {
      "hostname": "MY-HOSTNAME",
      "tailscale_ip": "100.x.x.x",
      "ssh_user": "myuser",
      "platform": "win32",
      "agent_id": "my-pc",
      "label": "My PC",
      "bot_token": "YOUR_TELEGRAM_BOT_TOKEN"
    }
  }
}
```

### 3. Deploy to a Machine

**macOS / Linux:**
```bash
./node-setup.sh --agent-id my-pc --bot-token "YOUR_BOT_TOKEN"
```

**Windows (PowerShell):**
```powershell
.\node-setup.ps1 -AgentId "my-pc" -BotToken "YOUR_BOT_TOKEN"
```

### 4. Start the Dashboard

```bash
node dashboard/server.js
# Open http://localhost:3000
```

### 5. Start Heartbeat on Each Machine

```bash
node monitor/heartbeat.js --agent-id my-pc --config ./fleet-config.json
```

Or install as a system service (auto-start on boot):
```bash
# macOS
bash service/install-heartbeat-mac.sh --agent-id my-pc

# Linux
sudo bash service/install-heartbeat-linux.sh --agent-id my-pc

# Windows (PowerShell)
.\service\install-heartbeat-win.ps1 -AgentId "my-pc"
```

## Inter-Agent Communication (SSH Dispatch)

Agents communicate through a **hub-and-spoke** model: the hub agent (总控虾) dispatches tasks to other agents via SSH, and responses are posted back to the Telegram group via `--deliver` for full visibility.

```
User → Hub Agent (macbook)
              │
    ┌─────────┼─────────┐
    │ SSH     │ SSH     │ SSH
    ▼         ▼         ▼
 Agent1    Agent2    Agent3
    │         │         │
    └─────────┼─────────┘
         --deliver
              │
    Telegram Group (all visible)
```

### Dispatch Script

```bash
# Evaluate a task (agent plans but doesn't execute)
bash shared/skills/fleet-dispatch/dispatch.sh macmini "【评估任务】Write a calculator app"

# Execute a task
bash shared/skills/fleet-dispatch/dispatch.sh macmini "【执行任务】Write a calculator app"
```

The script reads SSH credentials from `fleet-config.json`, connects to the target machine, and runs `openclaw agent --deliver` so the response appears in the Telegram group.

### Why SSH, Not Bot-to-Bot Messaging?

Telegram bots **cannot see other bots' messages** (server-side restriction). The same limitation exists in Feishu/Lark. SSH dispatch solves this by having the hub agent directly invoke commands on remote machines, with `--deliver` ensuring all results are posted to the shared Telegram group for auditability.

### SSH Requirements

Every machine that receives dispatched tasks needs SSH enabled:
- **macOS**: System Settings → General → Sharing → Remote Login
- **Windows**: `Get-Service sshd | Start-Service`
- **Linux**: `sudo systemctl enable --now sshd`

The dashboard monitors SSH connectivity every 60 seconds and shows green/red SSH badges per machine.

## Architecture

### Heartbeat System (`monitor/heartbeat.js`)

Each machine runs a heartbeat process that:

1. **Collects system info** — CPU, memory, uptime, Tailscale IP
2. **Checks agent health** — Is the OpenClaw gateway running? Is Telegram reachable?
3. **Writes status file** — `shared/heartbeats/{agent-id}.json` (synced via Syncthing)
4. **Runs HTTP command server** — Port 18790, accepts remote commands

The heartbeat handles cross-platform complexity:
- **Windows**: Finds `openclaw.cmd` through 4 fallback paths (npm global, APPDATA, Program Files, npx)
- **macOS**: Checks homebrew, nvm, npm prefix paths
- **BOM handling**: Strips UTF-8 BOM from Windows-edited JSON files
- **`windowsHide: true`**: Prevents console popups on Windows for all `exec` calls

### Dashboard (`dashboard/server.js`)

Zero-dependency single-file HTTP server with embedded HTML/CSS/JS:
- Reads heartbeat JSON files from `shared/heartbeats/`
- Aggregates fleet-wide metrics (tokens used, sessions, costs)
- Sends remote commands via HTTP to each machine's port 18790
- Apple-style glass morphism UI

### Remote Commands

The heartbeat HTTP server (port 18790) accepts these commands:

| Command | Description |
|---------|-------------|
| `restart` | Restart the AI agent gateway |
| `stop` | Stop the gateway |
| `start` | Start the gateway |
| `status` | Deep system status report |
| `doctor` | Run diagnostics |
| `update` | Update OpenClaw globally |
| `restart-heartbeat` | Reload heartbeat code (after Syncthing sync) |
| `config-set` | Change agent configuration remotely |
| `logs` | Show recent gateway logs |

### Syncthing Integration

Code and config changes propagate automatically:

```
Developer machine
    │ edit heartbeat.js
    ▼
Syncthing sync (seconds)
    │
    ▼
All machines have new code
    │
    ▼
fleet-updater.js --only machine1,machine2
    │ sends "restart-heartbeat" command via HTTP
    ▼
Machines reload with new code (zero downtime)
```

## Project Structure

```
claw-fleet/
├── monitor/
│   ├── heartbeat.js          # Heartbeat agent (runs on every machine)
│   ├── fleet-updater.js      # Batch remote update tool
│   ├── fleet-watchdog.js     # Auto-recovery watchdog
│   └── watchdog.js           # Telegram alert watchdog
├── dashboard/
│   └── server.js             # Web control panel (port 3000)
├── dashboard-electron/       # Electron desktop app (WIP)
├── db-api/                   # Shared database REST API
│   ├── schema.sql            # PostgreSQL schema
│   ├── server.js             # Fastify HTTP service
│   └── package.json
├── service/                  # Platform service installers
│   ├── install-heartbeat-mac.sh
│   ├── install-heartbeat-linux.sh
│   └── install-heartbeat-win.ps1
├── shared/
│   ├── skills/
│   │   └── fleet-dispatch/
│   │       └── dispatch.sh   # SSH task dispatch script
│   └── souls/                # Agent personality definitions
├── node-setup.sh             # One-click deploy (macOS/Linux)
├── node-setup.ps1            # One-click deploy (Windows)
├── fleet-config.example.json # Config template (safe to share)
└── fleet-config.json         # Your config (NOT in git, contains tokens)
```

## Lessons Learned (Pitfalls & Solutions)

Real problems we hit running 7 machines across Windows/macOS/Linux:

### 1. Windows `exec()` Popup Windows
**Problem:** Every `child_process.exec()` call spawns a visible cmd.exe window on Windows.
**Solution:** Add `windowsHide: true` to every `exec`/`execSync` call.

### 2. Windows PATH Can't Find npm Global Commands
**Problem:** `openclaw` installed globally via npm, but `exec()` can't find it.
**Solution:** 4-level fallback path resolution — `where openclaw.cmd` → `%APPDATA%/npm/` → `npm prefix -g` → `npx`.

### 3. Syncthing File Conflicts
**Problem:** Multiple machines writing to `fleet-status.json` simultaneously creates `.sync-conflict-*` files.
**Solution:** Each machine writes its own `shared/heartbeats/{agent-id}.json`. Dashboard reads all files from the directory.

### 4. UTF-8 BOM in JSON Files
**Problem:** Windows editors add BOM (`\uFEFF`) to JSON files, `JSON.parse()` fails.
**Solution:** `if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);` before parsing.

### 5. GFW Blocks Telegram (China-specific)
**Problem:** `api.telegram.org` is blocked in China, agents can't connect.
**Solution:** OpenClaw's built-in `channels.telegram.proxy: "socks5://127.0.0.1:7897"` + local proxy (Clash Verge TUN mode).

### 6. Tailscale MagicDNS vs Local Proxy DNS Conflict
**Problem:** Tailscale's MagicDNS (100.100.100.100) intercepts DNS queries, returns polluted IPs when combined with TUN-mode proxies.
**Solution:** `tailscale set --accept-dns=false` on affected machines.

### 7. macOS launchd PATH Missing Homebrew
**Problem:** launchd services can't find `node` or `openclaw` because `/opt/homebrew/bin` isn't in PATH.
**Solution:** Explicitly set PATH in plist `EnvironmentVariables`.

### 8. Heartbeat Crash = No Remote Recovery
**Problem:** When heartbeat crashes, port 18790 dies, dashboard can't send commands.
**Solution:** System-level auto-restart (launchd `KeepAlive`, systemd `Restart=always`). Future: SSH fallback in dashboard.

### 9. Cross-LAN Communication Fails
**Problem:** Machines on different WiFi networks (192.168.x.x) can't reach each other.
**Solution:** Always use Tailscale IPs (100.x.x.x). Dashboard prioritizes `tailscale_ip` over `local_ip`.

### 10. OpenClaw Config Uses camelCase
**Problem:** Setting `bot_token` doesn't work, documentation is unclear.
**Solution:** OpenClaw uses camelCase: `channels.telegram.botToken`, `groupPolicy`, etc.

## Reusable Components

These modules can be extracted and used in any distributed Node.js system:

| Module | Lines | What it does |
|--------|-------|-------------|
| `heartbeat.js` — System collector | ~80 | Cross-platform CPU/memory/uptime/Tailscale IP collection |
| `heartbeat.js` — Command server | ~200 | HTTP server on port 18790, accepts JSON commands, executes actions |
| `heartbeat.js` — Path finder | ~80 | Finds npm global binaries across Win/Mac/Linux with 4-level fallback |
| `heartbeat.js` — BOM-safe JSON reader | ~10 | Reads JSON files that may have Windows BOM characters |
| `dashboard/server.js` | ~1800 | Zero-dependency embedded web server with live-reload UI |
| `service/install-*.sh` | ~100 each | launchd/systemd/Windows service installers with auto-restart |
| `fleet-updater.js` | ~200 | Batch HTTP-based remote code reload across machines |

## Configuration Reference

See `fleet-config.example.json` for the full template. Key sections:

```json
{
  "fleet": {
    "telegram": {
      "group_id": "-100XXXXXXXXXX",
      "topics": { "logs": "TOPIC_ID" }
    }
  },
  "machines": {
    "machine-key": {
      "hostname": "...",
      "tailscale_ip": "100.x.x.x",
      "ssh_user": "...",
      "platform": "win32|darwin|linux",
      "agent_id": "...",
      "label": "Display Name",
      "bot_token": "TELEGRAM_BOT_TOKEN"
    }
  },
  "monitor": {
    "heartbeat_timeout": 600,
    "auto_restart": true,
    "max_restart_attempts": 3
  }
}
```

## Tech Stack

- **Runtime:** Node.js (zero external dependencies for core modules)
- **Networking:** Tailscale (VPN mesh), Syncthing (file sync)
- **Platforms:** Windows, macOS, Linux
- **AI Runtime:** OpenClaw (optional, heartbeat works without it)
- **Database:** PostgreSQL + pgvector (optional, for shared knowledge base)
- **Messaging:** Telegram Bot API (optional, for alerts)

## Contributing

Issues and PRs welcome. This project grew from a real production fleet of 7 machines — if you're running distributed AI agents and hit a problem, chances are we've hit it too.

## License

MIT

---

<a name="中文"></a>

# Claw Fleet - 分布式 AI Agent 舰队管理系统

在你的多台电脑上运行 AI Agent 集群，带心跳监控、远程控制、自动重启的完整运维方案。

## 这个项目解决什么问题

市面上的多 Agent 框架（CrewAI、AutoGen、MetaGPT）都在**单机**运行。如果你有多台电脑，想让每台跑一个 AI Agent，并且需要：

- 实时监控所有机器的健康状态
- 远程重启/更新 Agent，不用 SSH 到每台机器
- Agent 崩溃后自动拉起
- 跨平台支持（Windows、macOS、Linux）
- 零云依赖，完全运行在局域网/VPN 上

目前没有开源项目做这件事。**Claw Fleet** 填补了这个空白。

## 核心功能

- **跨平台心跳** — 一个 `heartbeat.js` 跑遍 Win/Mac/Linux
- **Web 控制面板** — Apple 风格 UI，实时舰队总览，远程执行命令
- **四状态健康指示** — 运行中 / TG断连 / Gateway停止 / 离线
- **远程控制** — 通过 HTTP API（端口 18790）重启、停止、更新 Agent
- **SSH 舰队调度** — 总控虾通过 SSH 调度各机器 Agent，结果发到 Telegram 群可见
- **自动重启** — launchd / systemd / Windows 启动文件夹
- **热重载代码** — Syncthing 推送代码 + `restart-heartbeat` 重载
- **一键部署** — 新电脑运行一个脚本完成所有配置

## 快速开始

```bash
# 1. 克隆项目
git clone https://github.com/MARSAIalpha/claw-fleet.git
cd claw-fleet

# 2. 复制配置模板
cp fleet-config.example.json fleet-config.json
# 编辑 fleet-config.json，填入你的机器信息

# 3. 在每台机器上部署
./node-setup.sh --agent-id my-pc --bot-token "YOUR_BOT_TOKEN"

# 4. 启动 Dashboard
node dashboard/server.js
# 访问 http://localhost:3000

# 5. 安装为系统服务（开机自启）
bash service/install-heartbeat-mac.sh --agent-id my-pc
```

## 踩坑记录

详见上方英文版 [Lessons Learned](#lessons-learned-pitfalls--solutions) 章节，包含 10 个我们在 7 台机器上踩过的真实坑及解决方案。

## 许可证

MIT
