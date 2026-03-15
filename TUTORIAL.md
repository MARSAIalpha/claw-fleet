# 小龙虾舰队搭建教程：从零开始的完整指南

> 作者: Simon + Claude | 版本: v1.0 | 日期: 2026-03-13
>
> 这份教程不只教你怎么做，还教你为什么这么做。每一步都附带背景知识，
> 让你理解背后的原理，遇到问题时能自己判断和解决。

---

## 目录

- [前言：你要搭的东西长什么样](#前言)
- [Step 0：理解网络基础知识](#step-0)
- [Step 1：购买和配置云服务器](#step-1)
- [Step 2：在 VPS 上安装基础软件](#step-2)
- [Step 3：配置 Syncthing 文件同步](#step-3)
- [Step 4：创建 Telegram 超级群组和 Bot](#step-4)
- [Step 5：部署主控 Agent（VPS）](#step-5)
- [Step 6：部署本地 Agent（你的电脑）](#step-6)
- [Step 7：测试和验证](#step-7)
- [Step 8：日常运维](#step-8)
- [附录：故障排查手册](#附录)

---

<a name="前言"></a>
## 前言：你要搭的东西长什么样

想象你是一个将军，手下有 6 只小龙虾各司其职。它们分散在不同的电脑上，
但能通过两种方式协作：

1. **说话**（Telegram）— 汇报进度、接收指令、互相通知
2. **传递物资**（Syncthing 文件同步）— 传剧本、图片、视频等大文件

中间有一台云服务器作为"司令部"，跑着指挥虾（主控 Agent）和看门狗（监控系统），
24小时在线，盯着所有小龙虾的状态。

**完成后你能做到：**
- 在手机 Telegram 里给指挥虾下命令，它自动分配给其他虾
- 任何一台电脑上的虾崩了，30秒内自动重启
- 你在一处修改配置，所有电脑自动同步更新
- 每天早上收到舰队状态日报

---

<a name="step-0"></a>
## Step 0：理解网络基础知识

> 🎓 **这一步不需要动手操作**，但理解这些概念会让后面的步骤不再迷糊。

### 0.1 IP 地址：电脑的"门牌号"

每台联网的设备都有一个 IP 地址，就像家庭住址。IP 分两种：

**内网 IP（私有 IP）**
- 长这样：`192.168.x.x` 或 `10.x.x.x` 或 `172.16.x.x`
- 只在你家路由器的范围内有效
- 你家电脑和手机都有各自的内网 IP
- 类比：**小区内的门牌号**，出了小区别人不认识

**公网 IP（公有 IP）**
- 长这样：`47.96.123.45`（任意数字组合，不在上面那三个范围内）
- 全球唯一，互联网上任何人都能通过它找到你
- 类比：**真正的街道地址**，全世界都能寄快递到这里

**为什么你之前连不上？**
你的 4+ 台电脑都有内网 IP，但它们在不同的网络里（比如家、公司、咖啡馆），
彼此的内网 IP 互相看不到。就像你知道你朋友住"3号楼201"，
但你不知道他在哪个小区——这个门牌号在每个小区里都可能存在。

### 0.2 端口：门牌号里的"房间号"

一台电脑上可以同时运行很多服务（网页、文件传输、数据库...），
每个服务占用一个**端口号**来区分。

- IP 地址 = 这栋楼的地址
- 端口 = 楼里的房间号

常见端口：
| 端口 | 用途 |
|------|------|
| 80 | 网页（HTTP） |
| 443 | 加密网页（HTTPS） |
| 22 | SSH 远程登录 |
| 8384 | Syncthing 管理界面 |
| 22000 | Syncthing 数据传输 |

当你访问 `http://47.96.123.45:8384` 时，意思是：
"找到公网IP为 47.96.123.45 的那台电脑，连接它的 8384 号房间（Syncthing）"

### 0.3 NAT 和路由器：小区的"保安亭"

你家路由器做的事叫 **NAT（网络地址转换）**：

```
你家电脑（内网 192.168.1.100）
    ↕
路由器（内网 192.168.1.1 / 公网 ?.?.?.?）  ← 这个公网IP是运营商分配的
    ↕
互联网
```

**出去容易，进来难：**
- 你的电脑访问百度 ✅ → 路由器帮你把请求转发出去，收到回复再转回来
- 外面的电脑想主动连你 ❌ → 路由器不知道应该转给内网的哪台电脑

这就是为什么两台在不同网络的电脑无法直连。

### 0.4 防火墙：房间的"门锁"

即使别人找到了你的地址和房间号，还有一道门：防火墙。
防火墙是操作系统的安全机制，默认**拒绝所有外来连接**。
你需要主动"开门"（开放端口）才能让别人连进来。

**云服务器的防火墙是双层的：**
1. 云平台的安全组（在网页控制台设置）
2. 服务器操作系统的 iptables/firewalld（在命令行设置）

两层都要开，外面才能连进来。

### 0.5 为什么我们的方案不需要你操心这些

**Telegram Bot API：**
Bot 不是等别人来连它，而是主动去 Telegram 服务器"拉"消息（轮询/webhook）。
所以你的电脑不需要公网 IP，不需要开端口——它只需要能上网。

**Syncthing：**
Syncthing 内置了三种连接方式：
1. **局域网直连**：同一网络的设备直接通信，速度最快
2. **NAT 穿透**：两台设备各自向一个公共服务器"打洞"，然后直连
3. **中继服务器**：如果前两种都失败，通过 Syncthing 的公共中继转发

所以 Syncthing 几乎在任何网络环境下都能工作，你不需要配防火墙。

**VPS 云服务器：**
这是唯一需要公网访问的部分。但云服务商已经帮你处理好了——
你购买后就有一个公网 IP，SSH 端口（22）默认开放。

### 0.6 SSH：远程控制服务器的方式

SSH（Secure Shell）是你在自己电脑上远程控制云服务器的工具。

```bash
# 连接命令
ssh root@47.96.123.45

# 意思是：用 SSH 协议，以 root 用户身份，连接到 47.96.123.45 这台服务器
```

**Windows 用户**：打开 PowerShell 或下载 PuTTY
**Mac 用户**：打开终端（Terminal）直接用

第一次连接会问你是否信任这台服务器，输入 `yes` 即可。
然后输入密码（购买服务器时设置的），就进入了服务器的命令行。

### 0.7 systemd：让程序永远运行的守护者

Linux 服务器上有一个叫 systemd 的系统管理工具。
它能让你的程序：
- 开机自动启动
- 崩溃后自动重启
- 后台运行（不占你的终端）

常用命令：
```bash
systemctl start xxx      # 启动服务
systemctl stop xxx       # 停止服务
systemctl restart xxx    # 重启服务
systemctl status xxx     # 查看状态
systemctl enable xxx     # 设置开机自启
journalctl -u xxx -f     # 查看实时日志
```

macOS 的对应工具叫 **launchd**，Windows 用**任务计划程序**。
我们的一键脚本已经帮你配好了这些。

---

<a name="step-1"></a>
## Step 1：购买和配置云服务器

> 预计用时：15-30 分钟
> 难度：⭐⭐ (简单，跟着点就行)

### 1.1 选择云服务商

推荐选择（任选其一）：

| 服务商 | 推荐产品 | 价格 | 适合 |
|--------|---------|------|------|
| 阿里云 | 轻量应用服务器 | ¥34/月起 | 国内访问最快 |
| 腾讯云 | 轻量应用服务器 | ¥32/月起 | 性价比高 |
| Vultr | Cloud Compute | $6/月起 | 海外访问更好 |

**推荐配置：** 2核 CPU / 2-4GB 内存 / 50GB SSD / Ubuntu 22.04

> 🎓 **为什么选 Ubuntu 22.04？**
> Ubuntu 是最流行的 Linux 发行版，22.04 是长期支持版（LTS），
> 意味着它会持续收到安全更新直到 2027 年。网上的教程和问题解答也最多。

### 1.2 购买步骤（以阿里云为例）

1. 访问 https://www.aliyun.com/product/swas
2. 选择"轻量应用服务器"
3. 镜像选择：**Ubuntu 22.04**
4. 套餐选择：2核2G 50GB（够用了）
5. 设置 root 密码（**记住这个密码！**）
6. 完成购买

### 1.3 配置安全组（开放端口）

> 🎓 **知识回顾：**
> 安全组是云平台层面的防火墙。默认只开了 SSH（22端口），
> 我们还需要开 Syncthing 的端口。

在阿里云控制台 → 你的服务器 → 安全组 → 添加规则：

| 端口 | 协议 | 用途 | 来源 |
|------|------|------|------|
| 22 | TCP | SSH 远程登录 | 0.0.0.0/0（已默认开放） |
| 8384 | TCP | Syncthing Web 管理 | 你的 IP（建议限制来源） |
| 22000 | TCP+UDP | Syncthing 数据传输 | 0.0.0.0/0 |

> ⚠️ **安全提醒：** 8384 端口是 Syncthing 的管理界面，
> 建议只允许你的 IP 访问，不要开放给所有人。

### 1.4 第一次连接服务器

打开你电脑的终端（Mac 终端 / Windows PowerShell）：

```bash
ssh root@你的服务器公网IP
# 例如: ssh root@47.96.123.45
```

输入密码后，你会看到类似这样的提示符：

```
root@your-server:~#
```

恭喜！你现在已经在远程控制云服务器了。

---

<a name="step-2"></a>
## Step 2：在 VPS 上安装基础软件

> 预计用时：10-15 分钟
> 难度：⭐⭐ (复制粘贴命令)

### 2.1 更新系统

```bash
apt update && apt upgrade -y
```

> 🎓 **这在做什么？**
> `apt` 是 Ubuntu 的软件包管理器（类似 App Store）。
> `update` 更新软件列表，`upgrade` 安装所有可用更新。
> `-y` 表示自动确认，不需要你手动输入 yes。

### 2.2 安装 Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

验证：
```bash
node -v    # 应显示 v20.x.x
npm -v     # 应显示 10.x.x
```

> 🎓 **Node.js 是什么？**
> Node.js 是一个 JavaScript 运行环境。OpenClaw 和我们的监控脚本都是用 JavaScript 写的，
> 需要 Node.js 来运行。npm 是 Node.js 的包管理器，用来安装第三方库。

### 2.3 安装 OpenClaw

```bash
npm install -g openclaw
```

验证：
```bash
openclaw --version
```

> 🎓 **`-g` 是什么意思？**
> `-g` 表示全局安装（global），装完后在任何目录都能使用 `openclaw` 命令。
> 不加 `-g` 则只装在当前项目目录里。

### 2.4 安装 Syncthing

```bash
apt install -y syncthing
```

### 2.5 创建工作目录

```bash
# 创建主控工作区
mkdir -p ~/orchestrator-workspace

# 创建共享文件夹
mkdir -p ~/claw-shared/{素材库,剧本,分镜,视频,数据,任务队列}

# 创建舰队控制目录
mkdir -p ~/claw-fleet/{shared/{skills,souls,context},monitor}
```

> 🎓 **`~` 是什么？**
> `~` 代表当前用户的主目录。root 用户的主目录是 `/root`，
> 普通用户是 `/home/用户名`。

---

<a name="step-3"></a>
## Step 3：配置 Syncthing 文件同步

> 预计用时：20-30 分钟
> 难度：⭐⭐⭐ (需要在多台电脑上操作)

### 3.1 理解 Syncthing 的工作原理

> 🎓 **Syncthing 是什么？**
> 一个去中心化的文件同步工具。它不依赖任何公司的服务器（不像 iCloud、OneDrive），
> 而是让你的设备之间直接同步文件。
>
> **与网盘的区别：**
> - 网盘：文件存在别人的服务器上，你上传/下载
> - Syncthing：文件只存在你自己的设备上，设备之间直接同步
>
> **核心概念：**
> - **Device（设备）**：每台运行 Syncthing 的电脑
> - **Device ID**：设备的唯一标识，一长串字母数字（类似指纹）
> - **Folder（文件夹）**：需要同步的文件夹
> - **Folder ID**：文件夹的唯一标识，多台设备上同一个 ID = 同一个同步组

### 3.2 在 VPS 上启动 Syncthing

```bash
# 先修改配置，允许远程访问 Web 界面
syncthing generate
# 修改监听地址
sed -i 's/127.0.0.1:8384/0.0.0.0:8384/' ~/.local/state/syncthing/config.xml

# 用 systemd 启动（后台运行 + 开机自启 + 崩溃重启）
systemctl enable syncthing@root
systemctl start syncthing@root
```

> 🎓 **`0.0.0.0` 是什么？**
> `127.0.0.1` 表示"只允许本机访问"。
> `0.0.0.0` 表示"允许任何 IP 访问"。
> 我们改成 0.0.0.0 是为了让你从自己的电脑浏览器打开 Syncthing 管理界面。

### 3.3 访问 Syncthing 管理界面

在你自己的电脑浏览器中打开：

```
http://你的VPS公网IP:8384
```

第一次打开会提示设置用户名和密码 — **一定要设！** 否则任何人都能管你的文件。

### 3.4 记录 VPS 的 Device ID

在 Syncthing Web 界面右上角 → Actions → Show ID

你会看到一串类似这样的文字：
```
ABCDEFG-HIJKLMN-OPQRSTU-VWXYZ12-3456789-ABCDEFG-HIJKLMN-OPQRSTU
```

**把这串 ID 复制保存下来**，每台本地电脑都需要用它来连接 VPS。

### 3.5 在 VPS 上创建共享文件夹

在 Syncthing Web 界面 → Add Folder：

| 设置项 | 值 |
|--------|-----|
| Folder Label | claw-shared |
| Folder ID | claw-shared |
| Folder Path | /root/claw-shared |
| Folder Type | Send & Receive |

再创建一个：

| 设置项 | 值 |
|--------|-----|
| Folder Label | claw-fleet |
| Folder ID | claw-fleet |
| Folder Path | /root/claw-fleet |
| Folder Type | Send Only |

> 🎓 **为什么 claw-fleet 是 Send Only？**
> claw-fleet 里是配置文件和脚本，应该只从 VPS 发到各电脑，
> 不允许各电脑反向修改。这样你在 VPS 上改配置，所有电脑自动更新。
> claw-shared 是双向的，因为各个小龙虾都要往里面写文件。

### 3.6 在你的每台电脑上安装 Syncthing

**macOS：**
```bash
brew install syncthing
# 启动
brew services start syncthing
```

**Windows：**
1. 下载 https://syncthing.net/downloads/
2. 解压到 `C:\syncthing\`
3. 运行 `syncthing.exe`

两个系统都可以在浏览器打开 `http://localhost:8384` 访问管理界面。

### 3.7 连接本地电脑到 VPS

在本地电脑的 Syncthing 界面：

1. **Add Remote Device**（添加远程设备）
2. 粘贴 VPS 的 Device ID
3. Device Name 填：`Simon VPS`
4. 保存

然后回到 VPS 的 Syncthing 界面，会看到一个连接请求 → 点 **Accept**

接受后，VPS 会提示共享文件夹 → 勾选 `claw-shared` 和 `claw-fleet` → 保存

**在本地电脑上设置同步路径：**
- claw-shared → `~/claw-shared`（macOS）或 `C:\Users\你的用户名\claw-shared`（Windows）
- claw-fleet → `~/claw-fleet`（macOS）或 `C:\Users\你的用户名\claw-fleet`（Windows）

### 3.8 验证同步

在 VPS 上创建一个测试文件：
```bash
echo "hello from VPS" > ~/claw-shared/test.txt
```

等待 10-30 秒，检查本地电脑上是否出现了这个文件。
如果出现了，文件同步就配好了！

> ⚠️ **每台电脑都重复 3.6-3.7 步骤！** 一共 4+ 台电脑都要连到 VPS。

---

<a name="step-4"></a>
## Step 4：创建 Telegram 超级群组和 Bot

> 预计用时：15-20 分钟
> 难度：⭐⭐ (在手机上操作)

### 4.1 理解 Telegram Bot 的工作原理

> 🎓 **Telegram Bot 是什么？**
> Bot 是 Telegram 里的自动化账号。它不是一个真人，而是一个程序。
> 你的 OpenClaw Agent 通过 Bot 来收发消息。
>
> **Bot 是怎么收到消息的？**
> Bot 不是像人一样"登录"着等消息来。而是你的 OpenClaw Gateway 程序
> 不断向 Telegram 服务器"轮询"（poll）：有没有新消息？有没有新消息？
>
> 这就是为什么你的电脑不需要公网 IP ——
> 是你的程序主动去"拿"消息，而不是 Telegram 主动"推"给你。
>
> **Bot Token 是什么？**
> 一串类似 `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` 的密钥。
> 拥有这个 Token 就能控制这个 Bot。**千万不要泄露！**

### 4.2 创建 Telegram Bot

1. 打开 Telegram，搜索 **@BotFather**（Telegram 官方的 Bot 管理员）
2. 发送 `/newbot`
3. 按提示输入：
   - Bot 名称：`Simon Orchestrator`（显示名，随便起）
   - Bot 用户名：`simon_orch_bot`（唯一标识，必须以 `_bot` 结尾）
4. BotFather 会返回一个 **Token** — **立即保存！**

**重复此步骤创建 6 个 Bot：**

| Bot 名称 | 用户名建议 | 对应 Agent |
|---------|-----------|-----------|
| Simon Orchestrator | simon_orch_bot | 指挥虾 |
| Simon Writer | simon_writer_bot | 编剧虾 |
| Simon Artist | simon_artist_bot | 美术虾 |
| Simon Video | simon_video_bot | 视频虾 |
| Simon Publisher | simon_pub_bot | 发布虾 |
| Simon DataBot | simon_data_bot | 数据虾 |

### 4.3 关键设置：关闭 Privacy Mode

**对每一个 Bot 都要做这一步：**

1. 在 @BotFather 中发送 `/mybots`
2. 选择你的 Bot
3. Bot Settings → Group Privacy → Turn off

> 🎓 **为什么要关闭 Privacy Mode？**
> 默认情况下，群里的 Bot 只能看到 @它 的消息和命令消息。
> 关闭 Privacy Mode 后，Bot 能看到群里所有消息。
> 这对 Agent 协作很重要——它需要了解对话上下文。

### 4.4 创建超级群组

1. 在 Telegram 中创建新群组
2. 命名为 **"Simon's Claw Team"**
3. 进入群设置 → **开启 Topics（话题/论坛模式）**
4. 创建以下 Topics：

```
#指挥部    - 指挥虾发布指令和状态
#编剧组    - 剧本创作讨论
#美术组    - 美术素材相关
#视频组    - 视频合成相关
#发布组    - 多平台发布相关
#数据组    - 数据分析相关
#日志      - 心跳和系统日志
```

5. 把所有 6 个 Bot 添加到群组
6. 每个 Bot 都设为**管理员**（群设置 → 管理员 → 添加）

### 4.5 获取群组 ID 和 Topic ID

这一步需要一点技巧。在群组里随便发一条消息，然后用任意一个 Bot 的 Token：

```bash
curl "https://api.telegram.org/bot你的Token/getUpdates" | python3 -m json.tool
```

> 🎓 **这个命令在做什么？**
> `curl` 是一个命令行的 HTTP 请求工具。
> 这行命令向 Telegram 的服务器发请求，获取 Bot 最近收到的消息。
> `python3 -m json.tool` 只是让返回的 JSON 数据更易读。

在返回结果中找到：
- `chat.id`：一个**负数**，如 `-1001234567890` — 这是群组 ID
- `message_thread_id`：每个 Topic 的 ID（数字）

**把这些 ID 记录到 `fleet-config.json` 的对应位置。**

---

<a name="step-5"></a>
## Step 5：部署主控 Agent（VPS）

> 预计用时：10-15 分钟
> 难度：⭐⭐

### 5.1 上传配置文件

如果 Syncthing 已经配好，`claw-fleet` 文件夹已经同步到 VPS。
否则手动上传：

```bash
# 从你的电脑上传（在本地终端执行）
scp -r ~/claw-fleet root@你的VPS_IP:~/claw-fleet
```

> 🎓 **`scp` 是什么？**
> Secure Copy，基于 SSH 的安全文件传输。
> 语法：`scp 本地文件 用户@服务器:远程路径`

### 5.2 编辑主控配置

```bash
# 在 VPS 上
cd ~/orchestrator-workspace

# 编辑 openclaw.json，填入真实的 Bot Token 和 Group ID
nano openclaw.json
```

> 🎓 **`nano` 是什么？**
> Linux 上的文本编辑器，比 `vim` 简单得多。
> - 编辑完按 `Ctrl+O` 保存
> - 按 `Ctrl+X` 退出
> - 方向键移动光标

把 `YOUR_BOT_TOKEN_HERE` 替换为指挥虾 Bot 的真实 Token，
把 `-100XXXXXXXXXX` 替换为真实的群组 ID。

### 5.3 设置环境变量

```bash
# 编辑环境变量文件
nano ~/.bashrc

# 在文件末尾添加（替换为你的真实值）：
export CLAW_BOT_TOKEN_ORCH="你的指挥虾Bot Token"
export DEEPSEEK_API_KEY="你的DeepSeek API Key"
export ANTHROPIC_API_KEY="你的Claude API Key"

# 保存退出后，使其生效：
source ~/.bashrc
```

> 🎓 **为什么用环境变量？**
> 把 Token 和 API Key 直接写在代码文件里不安全——
> 如果代码上传到 GitHub，密钥就泄露了。
> 环境变量存在系统中，程序可以读取但不会出现在代码文件里。

### 5.4 运行 VPS 初始化脚本

```bash
cd ~/claw-fleet
chmod +x vps-setup.sh
./vps-setup.sh --bot-token "$CLAW_BOT_TOKEN_ORCH" --group-id "你的群组ID"
```

脚本会自动：
- 安装所有依赖
- 创建共享上下文文件
- 注册 systemd 服务
- 启动 Syncthing 和看门狗

### 5.5 启动主控 Agent

```bash
# 启动
systemctl start openclaw-orchestrator

# 检查状态
systemctl status openclaw-orchestrator

# 看实时日志
journalctl -u openclaw-orchestrator -f
```

如果看到类似 `Gateway started, listening for messages...` 就成功了！

### 5.6 测试主控

在 Telegram 群组的 #指挥部 中 @你的指挥虾Bot，发一条消息。
如果它回复了，主控就部署成功了。

---

<a name="step-6"></a>
## Step 6：部署本地 Agent（你的电脑）

> 预计用时：每台电脑 5-10 分钟
> 难度：⭐⭐

### 6.1 确保 Syncthing 已同步

先检查 `claw-fleet` 文件夹是否已经同步到本地电脑。
打开文件管理器看看 `~/claw-fleet/`（Mac）或 `C:\Users\你的用户名\claw-fleet\`（Windows）
是否有文件。

### 6.2 macOS 部署

打开终端，执行：

```bash
cd ~/claw-fleet
chmod +x node-setup.sh

# 部署编剧虾（替换为真实 Token）
./node-setup.sh --agent-id writer --bot-token "你的编剧虾Bot Token"
```

脚本会自动完成所有配置。完成后启动：

```bash
cd ~/openclaw/writer-workspace
openclaw gateway
```

或使用系统服务（后台运行）：
```bash
launchctl start com.simon.openclaw.writer
```

### 6.3 Windows 部署

以**管理员身份**打开 PowerShell，执行：

```powershell
cd C:\Users\你的用户名\claw-fleet

# 允许运行脚本（首次需要）
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

# 部署美术虾（替换为真实 Token）
.\node-setup.ps1 -AgentId artist -BotToken "你的美术虾Bot Token"
```

> 🎓 **Set-ExecutionPolicy 是什么？**
> Windows 默认不允许运行下载的脚本（安全考虑）。
> `RemoteSigned` 允许运行本地脚本，但要求下载的脚本必须有签名。
> 这是最安全的启用方式。

完成后启动：
```powershell
cd C:\Users\你的用户名\openclaw\artist-workspace
openclaw gateway
```

或使用计划任务（后台运行）：
```powershell
Start-ScheduledTask -TaskName "OpenClaw-artist"
```

### 6.4 每台电脑部署一个 Agent

按照上面的步骤，在每台电脑上部署对应的 Agent：

| 电脑 | 系统 | Agent | 命令 |
|------|------|-------|------|
| 电脑1 | Mac | writer | `./node-setup.sh --agent-id writer --bot-token "..."` |
| 电脑1 | Mac | databot | `./node-setup.sh --agent-id databot --bot-token "..."` |
| 电脑2 | Mac | artist | `./node-setup.sh --agent-id artist --bot-token "..."` |
| 电脑3 | Mac | video | `./node-setup.sh --agent-id video --bot-token "..."` |
| 电脑4 | Win | publisher | `.\node-setup.ps1 -AgentId publisher -BotToken "..."` |
| ... | ... | ... | ... |

> 💡 **一台电脑可以跑多个 Agent！** 只要分别执行不同的 agent-id 即可。

---

<a name="step-7"></a>
## Step 7：测试和验证

> 预计用时：15 分钟

### 7.1 检查清单

在每一项后面打 ✓：

**基础设施：**
- [ ] VPS 能通过 SSH 连接
- [ ] Syncthing 在所有设备上运行
- [ ] 所有设备在 Syncthing 中显示"已连接"
- [ ] 测试文件能在设备间同步

**Telegram：**
- [ ] 超级群组已创建，Topics 已建好
- [ ] 所有 Bot 已添加到群组并设为管理员
- [ ] Privacy Mode 已对所有 Bot 关闭

**Agent：**
- [ ] VPS 上的指挥虾已启动并能响应
- [ ] 每台电脑上的 Agent 已启动并能响应
- [ ] 在 #日志 频道能看到心跳消息

### 7.2 全链路测试

在 Telegram #指挥部 发送：

```
@指挥虾 请执行测试：
1. 让编剧虾在 claw-shared/剧本/ 下写一个100字测试文件
2. 完成后检查所有电脑是否同步收到了这个文件
3. 在 #日志 汇报结果
```

如果整个流程走通了——恭喜，你的小龙虾舰队已经就绪！

---

<a name="step-8"></a>
## Step 8：日常运维

### 8.1 常用操作速查

**查看所有 Agent 状态：**
```bash
# 在 VPS 上
cat ~/claw-fleet/shared/fleet-status.json | python3 -m json.tool
```

**更新某个 Agent 的角色定义：**
1. 编辑 VPS 上的 `~/claw-fleet/shared/souls/xxx.md`
2. Syncthing 自动同步到所有电脑
3. 重启对应 Agent 的 Gateway（或等它下次重启时生效）

**添加新的 Skill：**
1. 在 VPS 上的 `~/claw-fleet/shared/skills/` 下添加 Skill 文件
2. 自动同步到所有电脑

**查看指挥虾日志（VPS）：**
```bash
journalctl -u openclaw-orchestrator -f --no-pager
```

**重启某个 Agent（Mac）：**
```bash
launchctl stop com.simon.openclaw.writer
launchctl start com.simon.openclaw.writer
```

**重启某个 Agent（Windows）：**
```powershell
Stop-ScheduledTask -TaskName "OpenClaw-writer"
Start-ScheduledTask -TaskName "OpenClaw-writer"
```

### 8.2 成本监控

每月检查：
- VPS 费用（固定）
- AI API 调用费用（按量）
- 关注 DeepSeek 余额（便宜但要注意不要超限）

---

<a name="附录"></a>
## 附录：故障排查手册

### 问题：Agent 在 Telegram 中无响应

**排查步骤：**
1. Agent 进程是否在运行？
   - Mac: `launchctl list | grep openclaw`
   - Windows: `Get-ScheduledTask -TaskName "OpenClaw-*"`
   - VPS: `systemctl status openclaw-orchestrator`

2. Bot Token 是否正确？
   ```bash
   curl "https://api.telegram.org/bot你的Token/getMe"
   ```
   如果返回 Bot 信息就说明 Token 没问题。

3. Bot 是否在群组中且是管理员？
   在 Telegram 群设置中检查。

4. Privacy Mode 是否关闭？
   在 @BotFather 中检查。

### 问题：文件不同步

**排查步骤：**
1. 打开 Syncthing Web 界面 (`http://localhost:8384`)
2. 检查远程设备是否显示"Connected"
3. 检查文件夹状态是否显示"Up to Date"
4. 如果显示"Disconnected"，检查网络连接

### 问题：Agent 频繁崩溃重启

**排查步骤：**
1. 查看日志：
   - Mac: `cat ~/openclaw/xxx-workspace/gateway.log`
   - VPS: `journalctl -u openclaw-xxx --since "1 hour ago"`

2. 常见原因：
   - API Key 无效或余额不足
   - openclaw.json 格式错误（JSON 语法错误）
   - 内存不足（小内存 VPS 跑太多东西）

### 问题：心跳告警但 Agent 实际在运行

**可能原因：**
- 心跳脚本崩了（重启心跳服务）
- fleet-status.json 被 Syncthing 冲突（删除 `.sync-conflict` 文件）
- 时钟不同步（极少见）

---

## 学习资源推荐

想深入了解上面这些概念，推荐这些资源：

**网络基础：**
- 搜索"计算机网络入门"系列视频（B站上有很多优质免费课程）
- 关键词：TCP/IP、NAT、端口、防火墙、SSH

**Linux 基础：**
- 搜索"Linux 入门教程"
- 关键词：bash 命令、文件权限、systemd、环境变量

**OpenClaw：**
- 官方文档：https://docs.openclaw.ai
- GitHub Wiki：搜索 "openclaw multi-agent"

记住：不需要一次学完所有知识。遇到具体问题时再去查，效率最高。
