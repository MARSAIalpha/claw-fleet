# Claw Fleet - 小龙虾舰队控制系统

一套自动化脚本，用于统一管理分布在多台电脑上的 OpenClaw Agent 舰队。

## 功能
- **一键部署**：新电脑运行一个脚本即可完成所有配置
- **统一配置分发**：VPS 上修改配置，所有电脑自动同步
- **心跳监控**：每个 Agent 定时报到，主控自动检测掉线
- **故障自动拉起**：Agent 进程崩溃后自动重启
- **Skill 统一管理**：集中管理所有 Skill，一处更新全部生效

## 文件结构
```
claw-fleet/
├── README.md
├── vps-setup.sh              # VPS 一键初始化
├── node-setup.sh             # 本地电脑一键初始化 (Linux/Mac)
├── node-setup.ps1            # 本地电脑一键初始化 (Windows)
├── fleet-config.json         # 舰队统一配置
├── shared/                   # 通过 Syncthing 同步的共享资源
│   ├── skills/               # 统一 Skill 库
│   ├── souls/                # 统一角色定义
│   ├── context/              # 共享上下文
│   └── fleet-status.json     # 舰队状态文件
├── monitor/
│   ├── heartbeat.js          # 心跳发送脚本（每个 Agent 运行）
│   └── watchdog.js           # 主控监控脚本（VPS 运行）
└── service/
    ├── openclaw-agent.service  # Linux systemd 服务文件
    └── openclaw-agent.xml      # Windows 任务计划模板
```
