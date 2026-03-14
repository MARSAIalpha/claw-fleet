#!/usr/bin/env node
/**
 * 小龙虾心跳脚本 v2
 *
 * 每个 Agent 节点运行此脚本，定时报告:
 *   - 系统状态 (CPU/内存/运行时间)
 *   - Gateway 存活状态
 *   - OpenClaw 配置信息 (模型/认证/插件)
 *   - Token 使用统计
 *   - 会话 & 记忆数据
 *
 * 用法: node heartbeat.js --agent-id rog --interval 60
 *   --agent-id    Agent 标识
 *   --interval    心跳间隔(秒), 默认60
 *   --openclaw-dir  OpenClaw 配置目录, 默认 ~/.openclaw
 *   --status-file   共享状态文件路径
 *   --config        fleet-config.json 路径
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

// ── 版本号（每次更新 heartbeat.js 时递增，用于判断 Syncthing 是否已同步）──
const HEARTBEAT_VERSION = 5;

// ── 参数解析 ──
const args = parseArgs(process.argv.slice(2));
const AGENT_ID = args['agent-id'] || os.hostname();
const INTERVAL = parseInt(args['interval'] || '60') * 1000;
const FLEET_CONFIG_PATH = args['config'] || path.join(__dirname, '..', 'fleet-config.json');
const STATUS_FILE = args['status-file'] || path.join(__dirname, '..', 'shared', 'fleet-status.json');

// OpenClaw 配置目录: Windows 在 %USERPROFILE%\.openclaw, Mac/Linux 在 ~/.openclaw
const DEFAULT_OPENCLAW_DIR = os.platform() === 'win32'
  ? path.join(process.env.USERPROFILE || os.homedir(), '.openclaw')
  : path.join(os.homedir(), '.openclaw');
const OPENCLAW_DIR = args['openclaw-dir'] || DEFAULT_OPENCLAW_DIR;

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      result[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return result;
}

// ── 安全读取 JSON (处理 BOM) ──
function readJSON(filepath) {
  try {
    if (fs.existsSync(filepath)) {
      let raw = fs.readFileSync(filepath, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      return JSON.parse(raw);
    }
  } catch (e) {}
  return null;
}

// ── 系统信息采集 ──
function getSystemInfo() {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: Math.floor(os.uptime()),
    memory: {
      total: Math.floor(os.totalmem() / 1024 / 1024),
      free: Math.floor(os.freemem() / 1024 / 1024),
      usage_percent: Math.round((1 - os.freemem() / os.totalmem()) * 100)
    },
    cpu_count: os.cpus().length,
    cpu_model: os.cpus()[0]?.model || 'unknown',
    load: os.loadavg(),
    tailscale_ip: getTailscaleIP()
  };
}

// ── 获取 Tailscale IP ──
function getTailscaleIP() {
  try {
    const { execSync } = require('child_process');
    const platform = os.platform();
    let cmd;
    if (platform === 'win32') {
      cmd = 'tailscale ip -4';
    } else {
      cmd = 'tailscale ip -4 2>/dev/null || /usr/local/bin/tailscale ip -4 2>/dev/null';
    }
    return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
  } catch (e) {
    return null;
  }
}

// ── 查找 openclaw 完整路径（解决 Windows PATH 问题）──
function findOpenClawPath() {
  const { execSync } = require('child_process');
  const isWin = os.platform() === 'win32';

  // 先试直接调用
  try {
    execSync('openclaw --version', { encoding: 'utf8', timeout: 5000, stdio: ['pipe','pipe','pipe'] });
    return 'openclaw';
  } catch (e) {}

  if (isWin) {
    // Windows: 查找 openclaw.cmd 的位置
    // 方法1: where 命令
    try {
      const result = execSync('where openclaw.cmd 2>nul', { encoding: 'utf8', timeout: 5000 }).trim();
      if (result) {
        const p = result.split('\n')[0].trim();
        if (fs.existsSync(p)) return `"${p}"`;
      }
    } catch (e) {}

    // 方法2: 常见 npm 全局路径
    const npmPaths = [
      path.join(process.env.APPDATA || '', 'npm', 'openclaw.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'npm', 'openclaw.cmd'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'openclaw.cmd'),
      path.join(os.homedir(), 'AppData', 'Local', 'npm', 'openclaw.cmd'),
      'C:\\Program Files\\nodejs\\openclaw.cmd',
    ];
    for (const p of npmPaths) {
      if (p && fs.existsSync(p)) return `"${p}"`;
    }

    // 方法3: 从 npm prefix 查找
    try {
      const prefix = execSync('npm prefix -g', { encoding: 'utf8', timeout: 5000 }).trim();
      const p = path.join(prefix, 'openclaw.cmd');
      if (fs.existsSync(p)) return `"${p}"`;
    } catch (e) {}

    // 方法4: npx 兜底
    try {
      execSync('npx openclaw --version', { encoding: 'utf8', timeout: 10000, stdio: ['pipe','pipe','pipe'] });
      return 'npx openclaw';
    } catch (e) {}
  }

  return 'openclaw'; // 兜底
}

// 启动时查找一次，后续复用
const OC_CMD = findOpenClawPath();

// ── 检查 Gateway 是否存活 ──
// 方法1: openclaw gateway status (最可靠，官方 CLI 命令)
// 方法2: netstat 查端口 (备选)
// 方法3: 进程命令行匹配 (兜底)
function checkGatewayProcess() {
  const { execSync } = require('child_process');

  // 方法1: 用官方 CLI 检查 gateway 状态
  try {
    const output = execSync(OC_CMD + ' gateway status', { encoding: 'utf8', timeout: 8000, stdio: ['pipe','pipe','pipe'] });
    // gateway status 正常返回说明 gateway 在运行
    if (output && !output.toLowerCase().includes('not running') && !output.toLowerCase().includes('stopped')) {
      return true;
    }
  } catch (e) {
    // 命令失败说明 gateway 没运行，继续尝试其他方法
  }

  // 方法2: netstat 查端口
  const config = readJSON(path.join(OPENCLAW_DIR, 'openclaw.json'));
  const port = config?.gateway?.port || 18789;
  try {
    const platform = os.platform();
    let cmd;
    if (platform === 'win32') {
      cmd = `netstat -ano | findstr ":${port}" | findstr "LISTENING"`;
    } else {
      cmd = `ss -tlnp 2>/dev/null | grep ":${port}" || netstat -tlnp 2>/dev/null | grep ":${port}"`;
    }
    const output = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    if (output.trim().length > 0) return true;
  } catch (e) {}

  // 方法3: 备选 - 检查进程命令行
  try {
    const platform = os.platform();
    let cmd;
    if (platform === 'win32') {
      cmd = 'wmic process where "name=\'node.exe\'" get CommandLine 2>nul';
    } else {
      cmd = 'ps aux | grep "openclaw" | grep -v grep';
    }
    const output = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    return output.includes('openclaw') || output.includes('gateway');
  } catch (e) {
    return false;
  }
}

// ── 获取 OpenClaw 版本 ──
function getOpenClawVersion() {
  try {
    const { execSync } = require('child_process');
    return execSync(OC_CMD + ' --version', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch (e) {
    return 'unknown';
  }
}

// ── 采集 OpenClaw 配置信息 ──
function getOpenClawInfo() {
  const info = {
    config: null,
    models: [],
    auth_profiles: {},
    usage_stats: {},
    sessions: { active: 0, total: 0 },
    memory_db_size: 0,
    gateway: null,
    plugins: [],
    cron_jobs: 0
  };

  // 1. 主配置 openclaw.json
  const config = readJSON(path.join(OPENCLAW_DIR, 'openclaw.json'));
  if (config) {
    // 提取模型配置 (不泄露 apiKey)
    const modelsList = [];
    if (config.models?.providers) {
      for (const [provider, pConfig] of Object.entries(config.models.providers)) {
        if (pConfig.models && Array.isArray(pConfig.models)) {
          for (const m of pConfig.models) {
            modelsList.push({
              provider,
              id: m.id,
              name: m.name,
              contextWindow: m.contextWindow,
              maxTokens: m.maxTokens
            });
          }
        }
      }
    }
    info.models = modelsList;

    // 提取主模型和回退
    info.primary_model = config.agents?.defaults?.model?.primary || 'unknown';
    info.fallback_models = config.agents?.defaults?.model?.fallbacks || [];

    // 提取 gateway 配置 (不泄露 token)
    if (config.gateway) {
      info.gateway = {
        port: config.gateway.port,
        mode: config.gateway.mode,
        bind: config.gateway.bind,
        tailscale: config.gateway.tailscale?.mode || 'off'
      };
    }

    // 提取插件
    if (config.plugins?.entries) {
      info.plugins = Object.entries(config.plugins.entries)
        .filter(([_, v]) => v.enabled)
        .map(([k]) => k);
    }

    // workspace
    info.workspace = config.agents?.defaults?.workspace || 'unknown';

    // channels
    info.channels = {};
    if (config.channels) {
      for (const [ch, chConfig] of Object.entries(config.channels)) {
        info.channels[ch] = { enabled: chConfig.enabled || false };
      }
    }
  }

  // 2. 认证配置 & Token 使用统计
  const authProfiles = readJSON(path.join(OPENCLAW_DIR, 'agents', 'main', 'agent', 'auth-profiles.json'));
  if (authProfiles) {
    // 安全提取: 只暴露 provider 名和使用统计，不泄露 key
    if (authProfiles.profiles) {
      for (const [name, profile] of Object.entries(authProfiles.profiles)) {
        info.auth_profiles[name] = {
          type: profile.type,
          provider: profile.provider,
          has_key: !!(profile.key || profile.access)
        };
      }
    }
    if (authProfiles.usageStats) {
      for (const [name, stats] of Object.entries(authProfiles.usageStats)) {
        info.usage_stats[name] = {
          lastUsed: stats.lastUsed ? new Date(stats.lastUsed).toISOString() : null,
          errorCount: stats.errorCount || 0,
          lastFailureAt: stats.lastFailureAt ? new Date(stats.lastFailureAt).toISOString() : null
        };
      }
    }
  }

  // 3. 会话详情列表
  const sessionsFile = path.join(OPENCLAW_DIR, 'agents', 'main', 'sessions', 'sessions.json');
  const sessions = readJSON(sessionsFile);
  info.sessions = { list: [], total: 0, active: 0 };
  if (sessions) {
    const sessDir = path.join(OPENCLAW_DIR, 'agents', 'main', 'sessions');
    for (const [key, s] of Object.entries(sessions)) {
      if (!s || !s.sessionId) continue;
      // 计算会话文件大小
      let fileSize = 0;
      try {
        const files = fs.readdirSync(sessDir).filter(f => f.startsWith(s.sessionId) && f.endsWith('.jsonl'));
        for (const f of files) fileSize += fs.statSync(path.join(sessDir, f)).size;
      } catch (e) {}

      info.sessions.list.push({
        key,
        sessionId: s.sessionId,
        model: s.model || null,
        modelProvider: s.modelProvider || null,
        channel: s.lastChannel || s.deliveryContext?.channel || 'unknown',
        chatType: s.chatType || 'unknown',
        updatedAt: s.updatedAt ? new Date(s.updatedAt).toISOString() : null,
        authProfile: s.authProfileOverride || null,
        contextTokens: s.contextTokens || 0,
        compactionCount: s.compactionCount || 0,
        fileSize
      });
    }
    info.sessions.total = info.sessions.list.length;
    info.sessions.active = info.sessions.list.filter(s => s.updatedAt).length;
  }

  // 会话文件归档统计
  try {
    const sessDir = path.join(OPENCLAW_DIR, 'agents', 'main', 'sessions');
    if (fs.existsSync(sessDir)) {
      const allFiles = fs.readdirSync(sessDir);
      info.sessions.files = allFiles.filter(f => f.endsWith('.jsonl')).length;
      info.sessions.deleted = allFiles.filter(f => f.includes('.deleted.')).length;
      info.sessions.reset = allFiles.filter(f => f.includes('.reset.')).length;
    }
  } catch (e) {}

  // 4. 记忆数据库大小
  const memDbPath = path.join(OPENCLAW_DIR, 'memory', 'main.sqlite');
  try {
    if (fs.existsSync(memDbPath)) {
      const stat = fs.statSync(memDbPath);
      info.memory_db_size = stat.size; // bytes
    }
  } catch (e) {}

  // 5. Cron 任务详情
  const cronJobs = readJSON(path.join(OPENCLAW_DIR, 'cron', 'jobs.json'));
  info.cron_jobs = [];
  if (cronJobs?.jobs && Array.isArray(cronJobs.jobs)) {
    for (const job of cronJobs.jobs) {
      info.cron_jobs.push({
        id: job.id || job.jobId || 'unknown',
        name: job.name || job.id || '未命名',
        schedule: job.schedule || job.cron || job.cronExpression || null,
        enabled: job.enabled !== false,
        lastRunAt: job.lastRunAt || job.lastRun || null,
        nextRunAt: job.nextRunAt || job.nextRun || null,
        command: job.command || job.action || null,
        description: job.description || null
      });
    }
  }

  // 6. 技能列表
  info.skills = [];
  // 从最近的 session 里读取 skills snapshot
  if (sessions) {
    const anySession = Object.values(sessions).find(s => s.skillsSnapshot?.resolvedSkills);
    if (anySession) {
      for (const sk of anySession.skillsSnapshot.resolvedSkills) {
        info.skills.push({
          name: sk.name,
          description: (sk.description || '').slice(0, 120),
          source: sk.source || 'unknown'
        });
      }
    }
  }

  // 7. Token 使用量统计 (从 session JSONL 的 assistant message usage 字段)
  info.token_usage = { today: { input: 0, output: 0, cacheRead: 0, total: 0, cost: 0, requests: 0 },
                       days30: { input: 0, output: 0, cacheRead: 0, total: 0, cost: 0, requests: 0 } };
  try {
    const sessDir = path.join(OPENCLAW_DIR, 'agents', 'main', 'sessions');
    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const days30Start = now - 30 * 86400000;
    const activeFiles = fs.readdirSync(sessDir).filter(f => f.endsWith('.jsonl') && !f.includes('.deleted.') && !f.includes('.reset.'));
    for (const file of activeFiles) {
      try {
        const content = fs.readFileSync(path.join(sessDir, file), 'utf8');
        const lines = content.split('\n');
        // 从尾部读取，效率更高（最近的数据在后面）
        for (let i = lines.length - 1; i >= 0; i--) {
          if (!lines[i]) continue;
          try {
            const obj = JSON.parse(lines[i]);
            if (obj.type !== 'message' || !obj.message || obj.message.role !== 'assistant' || !obj.message.usage) continue;
            const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : (obj.message.timestamp ? new Date(obj.message.timestamp).getTime() : 0);
            if (ts < days30Start) break; // 超过30天就不看了
            const u = obj.message.usage;
            const bucket30 = info.token_usage.days30;
            bucket30.input += u.input || 0;
            bucket30.output += u.output || 0;
            bucket30.cacheRead += u.cacheRead || 0;
            bucket30.total += u.totalTokens || 0;
            bucket30.cost += u.cost?.total || 0;
            bucket30.requests++;
            if (ts >= todayStart.getTime()) {
              const bucketToday = info.token_usage.today;
              bucketToday.input += u.input || 0;
              bucketToday.output += u.output || 0;
              bucketToday.cacheRead += u.cacheRead || 0;
              bucketToday.total += u.totalTokens || 0;
              bucketToday.cost += u.cost?.total || 0;
              bucketToday.requests++;
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}

  // 8. 命令日志行数
  try {
    const logFile = path.join(OPENCLAW_DIR, 'logs', 'commands.log');
    if (fs.existsSync(logFile)) {
      const content = fs.readFileSync(logFile, 'utf8');
      info.command_log_entries = content.trim().split('\n').filter(Boolean).length;
    }
  } catch (e) {}

  // 9. 本机 Soul + Memory 文件（仅本机，用于 dashboard 展示/编辑）
  info.soul_file = null;
  info.memory_file = null;
  try {
    const fleetConfig = readJSON(FLEET_CONFIG_PATH);
    const fleetDir = path.dirname(FLEET_CONFIG_PATH);
    if (fleetConfig) {
      // 找本机对应的 agent → soul 路径
      const myAgent = (fleetConfig.agents || []).find(a => a.machine === AGENT_ID);
      if (myAgent?.soul) {
        const soulPath = path.join(fleetDir, myAgent.soul);
        if (fs.existsSync(soulPath)) {
          info.soul_file = {
            label: (myAgent.name || AGENT_ID) + ' Soul',
            path: soulPath,
            relativePath: myAgent.soul,
            content: fs.readFileSync(soulPath, 'utf8').substring(0, 8000)
          };
        }
      }
      // 兜底：按 agent_id 在 souls 目录里找
      if (!info.soul_file) {
        const soulsDir = path.join(fleetDir, 'shared', 'souls');
        if (fs.existsSync(soulsDir)) {
          for (const f of fs.readdirSync(soulsDir).filter(f => f.endsWith('.md'))) {
            const p = path.join(soulsDir, f);
            info.soul_file = {
              label: path.basename(f, '.md') + ' Soul',
              path: p,
              relativePath: 'shared/souls/' + f,
              content: fs.readFileSync(p, 'utf8').substring(0, 8000)
            };
            break; // 取第一个可用的
          }
        }
      }
      // Memory 文件: shared/memory/{AGENT_ID}.md
      const memoryDir = path.join(fleetDir, 'shared', 'memory');
      const memoryPath = path.join(memoryDir, AGENT_ID + '.md');
      if (!fs.existsSync(memoryDir)) {
        try { fs.mkdirSync(memoryDir, { recursive: true }); } catch (e) {}
      }
      if (!fs.existsSync(memoryPath)) {
        try { fs.writeFileSync(memoryPath, '', 'utf8'); } catch (e) {}
      }
      if (fs.existsSync(memoryPath)) {
        info.memory_file = {
          label: AGENT_ID + ' Memory',
          path: memoryPath,
          relativePath: 'shared/memory/' + AGENT_ID + '.md',
          content: fs.readFileSync(memoryPath, 'utf8').substring(0, 8000)
        };
      }
    }
  } catch (e) {}

  // ── Bot Token 同步状态 ──
  info.bot_config = { synced: false, expected: false, current: null };
  try {
    let raw = fs.readFileSync(FLEET_CONFIG_PATH, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const config = JSON.parse(raw);
    const machines = config.machines || {};
    const myMachine = Object.values(machines).find(m => m.agent_id === AGENT_ID) || machines[AGENT_ID];
    if (myMachine && myMachine.bot_token) {
      info.bot_config.expected = true;
      // 检查当前 openclaw 配置的 token
      try {
        const { execSync } = require('child_process');
        const current = execSync(OC_CMD + ' config get channels.telegram.bot_token', { encoding: 'utf8', timeout: 5000 }).trim();
        info.bot_config.current = current ? '已设置' : '未设置';
        info.bot_config.synced = current === myMachine.bot_token;
      } catch (e) {
        info.bot_config.current = '读取失败';
      }
    }
  } catch (e) {}

  return info;
}

// ── 写入共享状态文件（每台机器写独立文件，避免 Syncthing 冲突） ──
function updateStatusFile(status) {
  try {
    // 写到 shared/heartbeats/{agent-id}.json（独立文件，不冲突）
    const heartbeatsDir = path.join(path.dirname(STATUS_FILE), 'heartbeats');
    if (!fs.existsSync(heartbeatsDir)) {
      fs.mkdirSync(heartbeatsDir, { recursive: true });
    }
    const agentFile = path.join(heartbeatsDir, AGENT_ID + '.json');
    const tmpFile = agentFile + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(status, null, 2));
    fs.renameSync(tmpFile, agentFile);

    console.log(`[${new Date().toISOString()}] Heartbeat written: ${agentFile}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Failed to update status file:`, e.message);
  }
}

// ── Telegram 心跳 (可选) ──
function sendTelegramHeartbeat(status) {
  const botToken = process.env[`CLAW_BOT_TOKEN_${AGENT_ID.toUpperCase()}`] || process.env.CLAW_BOT_TOKEN;
  if (!botToken) return;

  try {
    const config = readJSON(FLEET_CONFIG_PATH);
    if (!config) return;
    const groupId = config.fleet?.telegram?.group_id;
    const logTopicId = config.fleet?.telegram?.topics?.['日志'];
    if (!groupId || !logTopicId) return;

    const emoji = status.gateway_alive ? '🟢' : '🔴';
    const memInfo = `内存: ${status.system.memory.usage_percent}%`;
    const text = `${emoji} [${AGENT_ID}] 心跳 | ${status.system.hostname} | ${memInfo} | ${new Date().toLocaleString('zh-CN')}`;

    const postData = JSON.stringify({
      chat_id: groupId,
      message_thread_id: parseInt(logTopicId),
      text,
      disable_notification: true
    });

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    req.on('error', () => {});
    req.write(postData);
    req.end();
  } catch (e) {}
}

// ── 主心跳 ──
function heartbeat() {
  // 获取本机局域网 IP
  const nets = os.networkInterfaces();
  let localIp = '';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { localIp = net.address; break; }
    }
    if (localIp) break;
  }

  const status = {
    agent_id: AGENT_ID,
    heartbeat_version: HEARTBEAT_VERSION,
    timestamp: new Date().toISOString(),
    gateway_alive: checkGatewayProcess(),
    system: getSystemInfo(),
    openclaw_version: getOpenClawVersion(),
    openclaw: getOpenClawInfo(),
    cmd_port: CMD_PORT,
    local_ip: localIp
  };

  console.log(`[${status.timestamp}] Heartbeat: gw=${status.gateway_alive}, mem=${status.system.memory.usage_percent}%, models=${status.openclaw.models.length}, profiles=${Object.keys(status.openclaw.auth_profiles).length}`);

  updateStatusFile(status);
  sendTelegramHeartbeat(status);
}

// ── HTTP 命令接收服务（让 dashboard 可以远程控制本机） ──
const CMD_PORT = parseInt(args['cmd-port'] || '18790');
const http = require('http');
const { exec } = require('child_process');

const cmdServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); return res.end(); }

  if (req.url === '/api/command' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const { command } = parsed;
        const oc = OC_CMD;
        const isWin = os.platform() === 'win32';
        let cmd;
        // update 类命令需要更长超时
        let execTimeout = 30000;
        switch (command) {
          case 'restart': cmd = isWin
            ? `${oc} gateway stop & start /B ${oc} gateway >nul 2>&1 & echo Gateway restarted`
            : `${oc} gateway stop ; nohup ${oc} gateway >/dev/null 2>&1 & echo Gateway restarted`;
            break;
          case 'stop':    cmd = `${oc} gateway stop`; break;
          case 'start':   cmd = isWin
            ? `start /B ${oc} gateway >nul 2>&1 & echo Gateway started`
            : `nohup ${oc} gateway >/dev/null 2>&1 & echo Gateway started`;
            break;
          case 'status':  cmd = `${oc} status --deep`; break;
          case 'doctor':  cmd = `${oc} doctor`; break;
          case 'version': cmd = `${oc} --version`; break;
          case 'logs':    cmd = `${oc} logs`; break;
          case 'cron':    cmd = `${oc} cron list`; break;
          case 'update':
            execTimeout = 180000; // 3分钟，Windows npm 安装很慢
            cmd = isWin
              ? `powershell -Command "npm install -g openclaw@latest; openclaw --version"`
              : `npm install -g openclaw@latest && ${oc} --version`;
            break;
          case 'update-restart':
            execTimeout = 180000;
            cmd = isWin
              ? `powershell -Command "npm install -g openclaw@latest; openclaw gateway stop; Start-Process -NoNewWindow openclaw -ArgumentList 'gateway'; openclaw --version"`
              : `npm install -g openclaw@latest ; ${oc} gateway stop ; nohup ${oc} gateway >/dev/null 2>&1 & ${oc} --version`;
            break;
          case 'config-set':
            // 远程设置 OpenClaw 配置
            if (parsed.key && parsed.value !== undefined) {
              cmd = `${oc} config set ${parsed.key} "${String(parsed.value).replace(/"/g, '\\"')}"`;
            } else {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              return res.end(JSON.stringify({ success: false, message: '需要 key 和 value 参数' }));
            }
            break;
          case 'restart-heartbeat':
            // 远程重启心跳进程（用于 Syncthing 同步新代码后重载）
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, message: '心跳将在 2 秒后重启', agent: AGENT_ID }));
            console.log(`[${new Date().toISOString()}] 收到重启心跳命令，2 秒后重启...`);
            setTimeout(() => {
              const { spawn } = require('child_process');
              const args = process.argv.slice(1);
              const child = spawn(process.execPath, args, {
                detached: true,
                stdio: 'ignore',
                cwd: process.cwd()
              });
              child.unref();
              process.exit(0);
            }, 2000);
            return; // 已经发送响应，直接返回
          default:
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, message: '不支持: ' + command }));
        }
        console.log(`[${new Date().toISOString()}] CMD: ${command} -> ${cmd} (timeout: ${execTimeout}ms)`);
        exec(cmd, { timeout: execTimeout, encoding: 'utf8', shell: isWin ? 'cmd.exe' : '/bin/sh' }, (err, stdout, stderr) => {
          const output = (stdout || '').trim();
          const errMsg = (stderr || '').trim();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: !err,
            message: output || errMsg || (err ? err.message : '完成'),
            agent: AGENT_ID
          }));
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }
  // 健康检查
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ agent: AGENT_ID, ok: true, ts: Date.now() }));
  }
  res.writeHead(404); res.end('Not Found');
});

cmdServer.listen(CMD_PORT, '0.0.0.0', () => {
  console.log(`   Command port: ${CMD_PORT}`);
});
cmdServer.on('error', (e) => {
  console.error(`[WARN] Command port ${CMD_PORT} failed: ${e.message} (remote control disabled)`);
});

// ── 10. 自动配置 Bot Token ──
function autoConfigBotToken() {
  try {
    let raw = fs.readFileSync(FLEET_CONFIG_PATH, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const config = JSON.parse(raw);
    const machines = config.machines || {};
    // 找到当前机器
    const myMachine = Object.values(machines).find(m => m.agent_id === AGENT_ID) ||
                      machines[AGENT_ID];
    if (!myMachine || !myMachine.bot_token) return;

    const token = myMachine.bot_token;
    const oc = OC_CMD;

    // 检查当前配置的 token 是否已经一致
    const { execSync } = require('child_process');
    try {
      const current = execSync(`${oc} config get channels.telegram.bot_token`, { encoding: 'utf8', timeout: 5000 }).trim();
      if (current === token) {
        console.log(`[BOT] Token 已配置，无需更新`);
        return;
      }
    } catch (e) {
      // config get 可能报错，继续设置
    }

    // 设置 bot token
    console.log(`[BOT] 自动配置 Telegram Bot Token...`);
    try {
      execSync(`${oc} config set channels.telegram.bot_token "${token}"`, { encoding: 'utf8', timeout: 10000 });
      console.log(`[BOT] Token 已设置，正在重启 Gateway...`);
      execSync(`${oc} gateway restart`, { encoding: 'utf8', timeout: 15000 });
      console.log(`[BOT] Gateway 已重启，Bot 配置完成 ✅`);
    } catch (e) {
      console.error(`[BOT] 配置失败: ${e.message}`);
    }
  } catch (e) {
    // fleet-config 读取失败，跳过
  }
}

// ── 启动 ──
console.log(`🦞 Heartbeat v2 started for [${AGENT_ID}]`);
console.log(`   Interval: ${INTERVAL / 1000}s`);
console.log(`   OpenClaw dir: ${OPENCLAW_DIR}`);
console.log(`   Status file: ${STATUS_FILE}`);
console.log(`   OpenClaw cmd: ${OC_CMD}`);

// 启动时自动配置 Bot Token
autoConfigBotToken();

heartbeat();
setInterval(heartbeat, INTERVAL);
