#!/usr/bin/env node
/**
 * 小龙虾舰队一键更新器 v2
 *
 * 在 VPS 上运行，自动更新所有机器的 OpenClaw + 配置 Telegram Bot
 *
 * 两阶段执行:
 *   阶段1: 重启所有心跳进程（让 Syncthing 同步的新代码生效）
 *   阶段2: 更新 OpenClaw + 配置 Bot Token + 设置 groupPolicy
 *
 * 用法: node fleet-updater.js [--skip-heartbeat-restart] [--only machine1,machine2]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'fleet-config.json');
const CMD_PORT = 18790;

// 参数解析
const args = process.argv.slice(2);
const skipHeartbeatRestart = args.includes('--skip-heartbeat-restart');
let onlyMachines = null;
const onlyIdx = args.indexOf('--only');
if (onlyIdx !== -1 && args[onlyIdx + 1]) {
  onlyMachines = args[onlyIdx + 1].split(',').map(s => s.trim());
}

// ── 读取配置 ──
function loadConfig() {
  let raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

// ── HTTP 请求 ──
function sendCommand(ip, body, timeout) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const req = http.request({
      hostname: ip, port: CMD_PORT, path: '/api/command', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: timeout || 120000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ success: false, message: data }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ success: false, message: 'timeout' }); });
    req.on('error', (e) => resolve({ success: false, message: e.message }));
    req.write(postData);
    req.end();
  });
}

function ping(ip) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: ip, port: CMD_PORT, path: '/ping', method: 'GET', timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`); }

// ── 获取在线机器列表 ──
function getTargetMachines(config) {
  const machines = config.machines || {};
  const targets = [];
  for (const [name, machine] of Object.entries(machines)) {
    if (machine.hidden) continue;
    if (!machine.tailscale_ip) continue;
    if (onlyMachines && !onlyMachines.includes(name) && !onlyMachines.includes(machine.agent_id)) continue;
    targets.push({ name, ...machine, agentId: machine.agent_id || name });
  }
  return targets;
}

// ══════════════════════════════════════════════════
//   阶段1: 重启所有心跳进程
// ══════════════════════════════════════════════════
async function phase1RestartHeartbeats(targets) {
  log('\n' + '═'.repeat(55));
  log('📡 阶段1: 重启心跳进程（加载新代码）');
  log('═'.repeat(55));

  const results = [];
  for (const m of targets) {
    log(`\n  ▸ ${m.label || m.name} (${m.tailscale_ip})`);

    // 先 ping
    const p = await ping(m.tailscale_ip);
    if (!p) {
      log('    ❌ 离线，跳过');
      results.push({ name: m.name, label: m.label, status: 'offline' });
      continue;
    }

    // 发送 restart-heartbeat 命令
    const r = await sendCommand(m.tailscale_ip, { command: 'restart-heartbeat' }, 10000);
    if (r.success) {
      log('    ✅ 心跳重启命令已发送');
      results.push({ name: m.name, label: m.label, status: 'restarting' });
    } else {
      // 旧版心跳不支持 restart-heartbeat 命令，跳过
      log(`    ⚠️  不支持 restart-heartbeat（可能是旧版心跳）: ${(r.message || '').substring(0, 100)}`);
      results.push({ name: m.name, label: m.label, status: 'old-version' });
    }
  }

  // 等待心跳重启完成
  const restartedCount = results.filter(r => r.status === 'restarting').length;
  if (restartedCount > 0) {
    log(`\n  ⏳ 等待 ${restartedCount} 台机器心跳重启 (10秒)...`);
    await sleep(10000);

    // 验证重启成功
    for (const r of results) {
      if (r.status !== 'restarting') continue;
      const m = targets.find(t => t.name === r.name);
      const p = await ping(m.tailscale_ip);
      if (p) {
        log(`    ✅ ${r.label || r.name} 心跳已恢复`);
        r.status = 'restarted';
      } else {
        log(`    ❌ ${r.label || r.name} 心跳未恢复，等待更长时间...`);
        await sleep(5000);
        const p2 = await ping(m.tailscale_ip);
        if (p2) {
          log(`    ✅ ${r.label || r.name} 心跳已恢复（延迟）`);
          r.status = 'restarted';
        } else {
          log(`    ❌ ${r.label || r.name} 心跳未恢复`);
          r.status = 'restart-failed';
        }
      }
    }
  }

  return results;
}

// ══════════════════════════════════════════════════
//   阶段2: 更新 OpenClaw + 配置
// ══════════════════════════════════════════════════
async function phase2UpdateMachine(m) {
  const ip = m.tailscale_ip;
  const label = m.label || m.name;
  const isWin = m.platform === 'win32';

  log(`\n${'─'.repeat(50)}`);
  log(`🖥️  ${label} (${m.agentId}) [${ip}] ${isWin ? 'Windows' : 'Mac/Linux'}`);
  log(`${'─'.repeat(50)}`);

  // 1. Ping
  log('  1️⃣  检测心跳...');
  const p = await ping(ip);
  if (!p) {
    log('  ❌ 无法连接，跳过');
    return { agent: m.agentId, label, status: 'offline' };
  }
  log('     ✅ 在线');

  // 2. 当前版本
  log('  2️⃣  查询版本...');
  const ver1 = await sendCommand(ip, { command: 'version' }, 10000);
  const currentVer = (ver1.message || '未知').trim();
  log(`     当前: ${currentVer}`);

  // 3. 更新 OpenClaw (给 Windows 3 分钟超时)
  log('  3️⃣  更新 OpenClaw...');
  const updateResult = await sendCommand(ip, { command: 'update' }, 200000);
  if (updateResult.success) {
    log(`     ✅ 更新成功: ${(updateResult.message || '').substring(0, 100)}`);
  } else {
    log(`     ⚠️  更新: ${(updateResult.message || '').substring(0, 200)}`);
  }

  // 4. 配置 Bot Token
  if (m.bot_token) {
    log('  4️⃣  配置 Bot Token...');
    const tokenResult = await sendCommand(ip, {
      command: 'config-set',
      key: 'channels.telegram.bot_token',
      value: m.bot_token
    }, 15000);
    if (tokenResult.success) {
      log(`     ✅ Token 已设置`);
    } else {
      log(`     ⚠️  Token: ${(tokenResult.message || '').substring(0, 200)}`);
    }

    // 5. groupPolicy = open
    log('  5️⃣  设置 groupPolicy=open...');
    const policyResult = await sendCommand(ip, {
      command: 'config-set',
      key: 'channels.telegram.groupPolicy',
      value: 'open'
    }, 15000);
    if (policyResult.success) {
      log(`     ✅ groupPolicy=open`);
    } else {
      log(`     ⚠️  策略: ${(policyResult.message || '').substring(0, 200)}`);
    }
  } else {
    log('  ⏭️  无 Bot Token，跳过 Telegram 配置');
  }

  // 6. 重启 Gateway
  log('  6️⃣  重启 Gateway...');
  const restartResult = await sendCommand(ip, { command: 'restart' }, 30000);
  if (restartResult.success) {
    log(`     ✅ Gateway 已重启`);
  } else {
    log(`     ⚠️  重启: ${(restartResult.message || '').substring(0, 200)}`);
  }

  // 7. 验证新版本
  await sleep(3000);
  log('  7️⃣  验证版本...');
  const ver2 = await sendCommand(ip, { command: 'version' }, 10000);
  const newVer = (ver2.message || '未知').trim();
  log(`     版本: ${newVer}`);

  const success = updateResult.success || restartResult.success;
  log(success ? `  ✅ ${label} 完成!` : `  ⚠️  ${label} 部分未成功`);

  return { agent: m.agentId, label, status: success ? 'updated' : 'partial', oldVer: currentVer, newVer };
}

// ── 主流程 ──
async function main() {
  const config = loadConfig();
  const targets = getTargetMachines(config);

  log('🦞 小龙虾舰队一键更新器 v2');
  log(`   目标机器: ${targets.length} 台`);
  if (onlyMachines) log(`   过滤: ${onlyMachines.join(', ')}`);
  log('');

  // ── 阶段 1: 重启心跳 ──
  let heartbeatResults = [];
  if (!skipHeartbeatRestart) {
    heartbeatResults = await phase1RestartHeartbeats(targets);
  } else {
    log('⏭️  跳过心跳重启 (--skip-heartbeat-restart)');
  }

  // ── 阶段 2: 更新所有机器 ──
  log('\n' + '═'.repeat(55));
  log('🔄 阶段2: 更新 OpenClaw + 配置 Telegram');
  log('═'.repeat(55));

  const results = [];
  for (const m of targets) {
    const result = await phase2UpdateMachine(m);
    results.push(result);
  }

  // ── 总结 ──
  log('\n' + '═'.repeat(55));
  log('📊 更新总结');
  log('═'.repeat(55));

  if (heartbeatResults.length > 0) {
    log('\n  心跳重启:');
    heartbeatResults.forEach(r => {
      const icon = r.status === 'restarted' ? '✅' :
                   r.status === 'old-version' ? '⚠️' :
                   r.status === 'offline' ? '🔴' : '❌';
      log(`    ${icon} ${r.label || r.name}: ${r.status}`);
    });
  }

  log('\n  OpenClaw 更新:');
  results.forEach(r => {
    const icon = r.status === 'updated' ? '✅' : r.status === 'offline' ? '🔴' : '⚠️';
    log(`    ${icon} ${r.label || r.name}: ${r.status} ${r.oldVer && r.newVer ? `(${r.oldVer} → ${r.newVer})` : ''}`);
  });

  const ok = results.filter(r => r.status === 'updated').length;
  const fail = results.filter(r => r.status !== 'updated').length;
  log(`\n  成功: ${ok}  失败/部分: ${fail}  共: ${results.length}`);
  log('\n🦞 更新完毕!');
}

main().catch(e => { console.error(e); process.exit(1); });
