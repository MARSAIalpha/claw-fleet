# 小龙虾舰队入职流程

新机器加入舰队的完整步骤。

## 适用场景
- 新 Mac/PC 加入舰队
- 重装系统后重新部署
- 更换 Agent 角色

---

## 阶段一：硬件准备（线下操作）

### 1.1 系统安装
- 安装 macOS / Windows / Linux
- 建议 macOS >= 13, Windows 10+, Ubuntu 22.04+

### 1.2 网络配置
- 连接 WiFi/Ethernet
- 安装 Tailscale 并登录同一账号
- 确认能访问 `100.x.x.x` 网段

### 1.3 安装基础软件
```bash
# macOS
brew install node syncthing

# Ubuntu
sudo apt update && sudo apt install -y nodejs npm syncthing

# Windows
# 下载安装：Node.js, Syncthing
```

---

## 阶段二：SSH 配置（Rog 主控机操作）

### 2.1 生成 SSH 密钥（如果还没有）
```bash
# 在新机器上
ssh-keygen -t ed25519 -C "your_email@example.com"

# 复制公钥到 Rog
ssh-copy-id -p 22 Rog@100.124.216.19   # Windows 用 PowerShell
```

### 2.2 在 Rog 上配置 SSH 别名
编辑 `~/.ssh/config`：
```ssh
Host macmini
    HostName 100.71.187.72
    User apple

Host p4
    HostName 100.79.7.113
    User simonh
```

---

## 阶段三：舰队配置（ Rog 主控机操作）

### 3.1 添加机器配置
编辑 `claw-fleet/fleet-config.json`：

```json
"machines": {
  "新机器id": {
    "hostname": "主机名",
    "tailscale_ip": "100.x.x.x",
    "ssh_user": "用户名",
    "platform": "darwin | win32 | linux",
    "agent_id": "新机器id",
    "label": "显示名称",
    "bot_token": "从 @BotFather 获取"
  }
}
```

### 3.2 添加 Agent 配置（如果是新角色）
```json
"agents": [
  {
    "id": "新agent id",
    "name": "角色名",
    "machine": "机器id",
    "model": "/",
    "soul": "shared/souls/xxx.md",
    "skills": [],
    "bot_token_env": "CLAW_BOT_TOKEN_XXX",
    "topic": "Telegram topic 名称",
    "heartbeat_interval": 300
  }
]
```

### 3.3 创建 Soul 文件（如需要）
在 `claw-fleet/shared/souls/` 创建 `{agent-id}.md`

### 3.4 Syncthing 配置
1. 在新机器安装 Syncthing
2. 在 Rog 打开 Syncthing Web UI (http://127.0.0.1:8384)
3. 添加新设备（设备 ID）
4. 添加共享文件夹 `claw-fleet`（排除 .git 目录）

---

## 阶段四：部署到新机器

### 4.1 macOS/Linux
```bash
# 复制部署脚本到新机器
scp claw-fleet/node-setup.sh macmini:~/

# SSH 进去执行
ssh macmini
chmod +x node-setup.sh
./node-setup.sh --agent-id 机器id --bot-token "BOT_TOKEN"
```

### 4.2 Windows
```powershell
# 复制部署脚本
scp claw-fleet/node-setup.ps1 p4:/

# 在 PowerShell 执行
.\node-setup.ps1 -AgentId "p4" -BotToken "BOT_TOKEN"
```

---

## 阶段五：验证部署

### 5.1 检查 OpenClaw 运行
```bash
# 在新机器上
openclaw agents list --bindings
```

### 5.2 检查心跳
```bash
# 在 Rog 上
tail -f C:\Users\Rog\claw-fleet\shared\heartbeats\新机器id.json
```

### 5.3 检查 Dashboard
访问 http://rog:3000 查看新机器是否显示"运行中"

### 5.4 测试 Telegram
在对应 Topic 发送消息，确认能正常回复

---

## 阶段六：远程管理配置

### 6.1 注册心跳自启动
心跳脚本已包含在 node-setup.sh 中自动注册

### 6.2 验证远程重启
```bash
# 从 Rog 远程重启新机器的心跳
node C:\Users\Rog\claw-fleet\monitor\fleet-updater.js --only 新机器id
```

---

## 常用命令速查

| 操作 | 命令 |
|------|------|
| SSH 连接 | `ssh 机器id` |
| 查看心跳 | `type C:\Users\Rog\claw-fleet\shared\heartbeats\{id}.json` |
| 远程重启心跳 | `node monitor\fleet-updater.js --only id` |
| 查看 Dashboard | http://rog:3000 |
| 查看 OpenClaw 日志 | `tail -f ~/clawd/gateway.log` |

---

## 故障排查

### 问题：Telegram 无法连接
- 原因：api.telegram.org 被 GFW 封锁
- 解决：开启代理/TUN 模式

### 问题：Syncthing 不同步
- 检查设备 ID 是否正确
- 检查网络连通性

### 问题：heartbeat 版本不匹配
- 运行：`node monitor/fleet-updater.js --only 机器id`
