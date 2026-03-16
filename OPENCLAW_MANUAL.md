# OpenClaw 操作手册 (v2026.3.x)

> 整理日期: 2026-03-13
> 适用版本: 2026.3.x

---

## 一、安装与初始化

```bash
# 安装
npm install -g openclaw

# 版本检查
openclaw --version

# 交互式初始化向导（首次配置）
openclaw onboard

# 配置向导
openclaw config
```

---

## 二、Gateway（网关/守护进程）管理

Gateway 是 OpenClaw 的核心后台进程，负责运行所有通道和 Agent。

```bash
# 安装为系统服务（macOS: launchd / Linux: systemd / Windows: Scheduled Task）
openclaw gateway install

# 启动
openclaw gateway start

# 停止
openclaw gateway stop

# 重启（修改配置后必须执行）
openclaw gateway restart

# 查看状态
openclaw gateway status

# 详细诊断状态
openclaw gateway status --deep

# 卸载系统服务
openclaw gateway uninstall
```

**Gateway start 可用参数：**
- `--port <端口>` — WebSocket 端口（默认 18789）
- `--bind <模式>` — 绑定模式：loopback / lan / tailnet / auto / custom
- `--password <密码>` — 密码覆盖
- `--allow-unconfigured` — 允许未配置模式启动（开发用）
- `--json` — JSON 输出（便于脚本处理）

---

## 三、配置管理

配置文件位置：`~/.openclaw/openclaw.json`

```bash
# 打开配置向导
openclaw config

# 读取配置项
openclaw config get <path>
# 例: openclaw config get channels.telegram.botToken

# 设置配置项
openclaw config set <path> <value>
# 例: openclaw config set channels.telegram.enabled true

# 删除配置项
openclaw config unset <path>
```

**也可以在 Telegram 聊天中使用（需 commands.config: true）：**
```
/config set <path> <value>
/config unset <path>
```

---

## 四、通道（Channels）管理

```bash
# 列出已配置的通道
openclaw channels list

# 检查通道健康状态
openclaw channels status

# 探测通道连接
openclaw channels status --probe

# 添加通道
openclaw channels add --channel <通道类型> --token <token>
# 例: openclaw channels add --channel telegram --token 123:abc

# WhatsApp QR 配对
openclaw channels login
```

**支持的通道：** Telegram, WhatsApp, Discord, Slack, Google Chat, Mattermost, Signal, iMessage, MS Teams

---

## 五、Telegram 配置（openclaw.json）

### 基础私聊配置

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "你的BOT_TOKEN",
      "dmPolicy": "allowlist",
      "allowFrom": [你的TelegramUserID],
      "streaming": "partial"
    }
  }
}
```

### 添加群组支持

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "你的BOT_TOKEN",
      "dmPolicy": "allowlist",
      "allowFrom": [你的TelegramUserID],
      "groupPolicy": "allowlist",
      "groups": {
        "-100xxxxxxxxxx": {
          "groupPolicy": "open",
          "requireMention": true
        }
      },
      "groupAllowFrom": [你的TelegramUserID],
      "streaming": "partial"
    }
  }
}
```

**groups 配置说明：**
- Key 是群组 Chat ID（负数，如 `-1003534331530`）
- `groupPolicy`: `"open"` 允许群内所有人触发 / `"allowlist"` 只允许 groupAllowFrom 中的用户
- `requireMention`: `true` 表示必须 @ bot 才会响应
- 通配符 `"*"` 表示允许所有群组

**话题（Topics）配置路径：**
```
channels.telegram.groups.<chatId>.topics.<threadId>
```
General 话题的 threadId 是 `1`

---

## 六、Agent（智能体）管理

```bash
# 列出所有 Agent
openclaw agents list

# 列出 Agent 及其路由绑定
openclaw agents list --bindings

# 添加新 Agent
openclaw agents add <名称>

# 删除 Agent
openclaw agents delete <名称>

# Agent 访问控制
openclaw agents acp
```

---

## 七、Skills（技能）管理

```bash
# 列出已安装技能
openclaw skills list

# 查看技能详情
openclaw skills info <技能名>

# 检查技能状态
openclaw skills check

# 从 ClawHub 安装技能
clawhub install <slug>

# 卸载技能
clawhub uninstall <slug>

# 更新所有技能
clawhub update --all
```

---

## 八、Plugins（插件）管理

```bash
# 列出插件
openclaw plugins list

# 启用/禁用插件
openclaw plugins enable <名称>
openclaw plugins disable <名称>
```

---

## 九、Cron（定时任务）

```bash
# 列出定时任务
openclaw cron list

# 添加定时任务
openclaw cron add

# 编辑定时任务
openclaw cron edit <id>

# 删除定时任务
openclaw cron rm <id>

# 启用/禁用
openclaw cron enable <id>
openclaw cron disable <id>

# 手动运行一次
openclaw cron run <id>
```

---

## 十、诊断与日志

```bash
# 健康检查
openclaw doctor

# 自动修复问题
openclaw doctor --repair
# （别名: openclaw doctor --fix）
# 会自动备份 openclaw.json.bak，移除未知配置项

# 查看实时日志
openclaw logs --follow

# JSON 格式日志
openclaw logs --json --limit 200
```

---

## 十一、备份与恢复

```bash
# 创建备份
openclaw backup create

# 只备份配置
openclaw backup create --config-only

# 验证备份
openclaw backup verify
```

---

## 十二、安全

```bash
# 安全审计
openclaw security audit

# 密钥管理
openclaw secrets
```

---

## 十三、其他常用命令

```bash
# 数据迁移（版本升级后）
openclaw migrate

# 重置配置
openclaw reset

# 完全卸载
openclaw uninstall

# 更新 OpenClaw
openclaw update

# 仪表板
openclaw dashboard
```

---

## 十四、日常最常用的 6 条命令

1. `openclaw gateway restart` — 改完配置后重启
2. `openclaw logs --follow` — 看实时日志排错
3. `openclaw channels status --probe` — 检查通道是否在线
4. `openclaw cron list` — 查看定时任务
5. `openclaw doctor` — 健康检查
6. `openclaw config get <path>` — 查看配置

---

## 十五、Simon 的舰队配置速查

- **配置文件**：`~/.openclaw/openclaw.json`
- **Telegram 群组 Chat ID**：见 `fleet-config.json`
- **Bot Token**：见 `fleet-config.json`（不要提交到 git）
- **VPS IP / Syncthing Device ID**：见 `fleet-config.json`
