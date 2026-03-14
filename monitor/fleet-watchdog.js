#!/usr/bin/env node
/**
 * 小龙虾舰队守护犬 (Fleet Watchdog)
 *
 * 在 VPS 上运行，定期检测所有机器的心跳和 Gateway 状态
 * 如果 Gateway 挂了，自动通过 HTTP 命令端口发送重启指令
 *
 * 用法: node fleet-watchdog.js [--interval 120] [--log-file watchdog.log]
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── 配置 ──────────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach((arg, i, arr) => {
  if (arg.startsWith('--')) args[arg.slice(2)] = arr[i + 1] || true;
});

const CHECK_INTERVAL = parseInt(args['interval'] || '120') * 1000; // 默认2分钟
const CMD_PORT = 18790;
const LOG_FILE = args['log-file'] || path.join(__dirname, 'watchdog.log');
const CONFIG_FILE = path.join(__dirname, '..', 'fleet-config.json');
const HEARTBEATS_DIR = path.join(__dirname, '..', 'shared', 'heartbeats');

// 本机 agent ID（VPS 自己不需要远程重启）
const SELF_AGENT = args['self'] || 'vps';

// ── Dashboard 通知配置 ───────────────────────────────
// 守护犬通过 HTTP 把告警推送到 Rog 的 dashboard
// 用法: --dashboard-host "100.124.216.19" --dashboard-port 3000
const DASHBOARD_HOST = args['dashboard-host'] || '100.124.216.19';  // Rog Tailscale IP
const DASHBOARD_PORT = parseInt(args['dashboard-port'] || '3000');
// 异常事件实时通知
const ALERT_ON_RESTART = true;   // Gateway 被重启时通知
const ALERT_ON_OFFLINE = true;   // 机器离线时通知

// ── 日志 ──────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {}
}

// ── Dashboard 通知推送 ───────────────────────────────
function sendToDashboard(alert) {
  const postData = JSON.stringify(alert);
  const options = {
    hostname: DASHBOARD_HOST,
    port: DASHBOARD_PORT,
    path: '/api/watchdog-alert',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 5000
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode !== 200) {
        log(`Dashboard 通知失败 [${res.statusCode}]: ${data}`);
      }
    });
  });
  req.on('error', (e) => log(`Dashboard 通知错误: ${e.message}`));
  req.write(postData);
  req.end();
}

// 发送实时告警
function sendAlert(msg, level) {
  log(`📢 告警: ${msg}`);
  sendToDashboard({
    type: 'alert',
    level: level || 'warning',
    message: msg,
    timestamp: new Date().toISOString()
  });
}

// ── 读取舰队配置 ──────────────────────────────────────
function loadMachines() {
  try {
    let raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const config = JSON.parse(raw);
    return config.machines || {};
  } catch (e) {
    log(`ERROR: 无法读取配置文件: ${e.message}`);
    return {};
  }
}

// ── HTTP 请求封装 ─────────────────────────────────────
function httpRequest(host, port, path, method, body, timeout) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: port,
      path: path,
      method: method || 'GET',
      timeout: timeout || 5000,
      headers: {}
    };

    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── 检查单台机器 ─────────────────────────────────────
async function checkMachine(name, machine) {
  const ip = machine.tailscale_ip;
  const agentId = machine.agent_id || name;

  if (!ip) {
    return { agent: agentId, label: machine.label, status: 'no_ip', msg: '未配置 IP' };
  }

  if (agentId === SELF_AGENT) {
    return { agent: agentId, label: machine.label, status: 'self', msg: '本机跳过' };
  }

  try {
    // 1. Ping 心跳端口
    const ping = await httpRequest(ip, CMD_PORT, '/ping', 'GET', null, 5000);

    if (!ping.data || !ping.data.ok) {
      return { agent: agentId, label: machine.label, status: 'ping_fail', msg: 'Ping 返回异常' };
    }

    // 2. 检查心跳文件里的 gateway_alive 状态
    let gatewayAlive = false;
    const heartbeatFile = path.join(HEARTBEATS_DIR, agentId + '.json');
    try {
      let raw = fs.readFileSync(heartbeatFile, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      const hb = JSON.parse(raw);
      gatewayAlive = hb.gateway_alive === true;
    } catch (e) {
      // 心跳文件读不到，但 ping 通了，可能是 Syncthing 延迟
    }

    if (gatewayAlive) {
      return { agent: agentId, label: machine.label, status: 'ok', msg: 'Gateway 运行中' };
    }

    // 3. Gateway 没活，尝试重启
    log(`⚠️  ${machine.label} (${agentId}) Gateway 未运行，正在远程重启...`);
    try {
      const restart = await httpRequest(ip, CMD_PORT, '/api/command', 'POST', { command: 'restart' }, 15000);
      if (restart.data && restart.data.success) {
        log(`✅ ${machine.label} (${agentId}) Gateway 重启成功`);
        return { agent: agentId, label: machine.label, status: 'restarted', msg: 'Gateway 已重启' };
      } else {
        const errMsg = restart.data?.message || restart.data || '未知错误';
        log(`❌ ${machine.label} (${agentId}) Gateway 重启失败: ${errMsg}`);
        return { agent: agentId, label: machine.label, status: 'restart_fail', msg: `重启失败: ${errMsg}` };
      }
    } catch (e) {
      log(`❌ ${machine.label} (${agentId}) 重启命令发送失败: ${e.message}`);
      return { agent: agentId, label: machine.label, status: 'restart_fail', msg: e.message };
    }

  } catch (e) {
    // Ping 不通 = 心跳进程挂了或机器离线
    return { agent: agentId, label: machine.label, status: 'offline', msg: `无法连接 (${e.message})` };
  }
}

// ── 巡检所有机器 ─────────────────────────────────────
async function patrol() {
  const machines = loadMachines();
  const names = Object.keys(machines);

  if (names.length === 0) {
    log('WARNING: 没有找到任何机器配置');
    return;
  }

  log(`━━━ 开始巡检 (${names.length} 台机器) ━━━`);

  const results = [];
  // 并发检查所有机器
  const checks = names.map(name => checkMachine(name, machines[name]));
  const settled = await Promise.allSettled(checks);

  settled.forEach((result, i) => {
    const name = names[i];
    if (result.status === 'fulfilled') {
      const r = result.value;
      const icon = r.status === 'ok' ? '🟢' :
                   r.status === 'self' ? '🔵' :
                   r.status === 'restarted' ? '🟡' :
                   r.status === 'offline' ? '🔴' : '⚪';
      log(`  ${icon} ${r.label || name}: ${r.msg}`);
      results.push(r);
    } else {
      log(`  🔴 ${name}: 检查出错 - ${result.reason}`);
    }
  });

  // 统计
  const online = results.filter(r => r.status === 'ok' || r.status === 'self').length;
  const restarted = results.filter(r => r.status === 'restarted').length;
  const offline = results.filter(r => r.status === 'offline').length;
  const failed = results.filter(r => r.status === 'restart_fail' || r.status === 'ping_fail').length;

  log(`━━━ 巡检完成: ${online} 在线, ${restarted} 已重启, ${offline} 离线, ${failed} 异常 ━━━\n`);

  // 推送告警到 Dashboard
  if (ALERT_ON_RESTART && restarted > 0) {
    const restartedList = results.filter(r => r.status === 'restarted').map(r => r.label).join(', ');
    sendAlert(`Gateway 已自动重启: ${restartedList}`, 'warning');
  }
  if (ALERT_ON_OFFLINE && offline > 0) {
    const offlineList = results.filter(r => r.status === 'offline').map(r => r.label).join(', ');
    sendAlert(`机器离线: ${offlineList}`, 'error');
  }

  // 每次巡检都推送完整报告到 Dashboard
  sendToDashboard({
    type: 'report',
    timestamp: new Date().toISOString(),
    summary: { online, restarted, offline, failed, total: names.length },
    machines: results
  });

  // 写巡检报告到共享目录
  try {
    const report = {
      timestamp: new Date().toISOString(),
      summary: { online, restarted, offline, failed, total: names.length },
      machines: results
    };
    const reportFile = path.join(HEARTBEATS_DIR, '_watchdog-report.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  } catch (e) {}
}

// ── 启动 ──────────────────────────────────────────────
log(`🐕 舰队守护犬启动 | 巡检间隔: ${CHECK_INTERVAL / 1000}s | 自身: ${SELF_AGENT}`);
log(`   配置文件: ${CONFIG_FILE}`);
log(`   心跳目录: ${HEARTBEATS_DIR}`);
log(`   日志文件: ${LOG_FILE}`);
log(`   Dashboard: ${DASHBOARD_HOST}:${DASHBOARD_PORT}\n`);

// 立即执行一次
patrol();

// 定时巡检
setInterval(patrol, CHECK_INTERVAL);
