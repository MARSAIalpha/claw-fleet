#!/usr/bin/env node
/**
 * 小龙虾舰队看门狗（运行在 VPS 上）
 *
 * 监控所有 Agent 的心跳状态，发现掉线自动告警。
 * 用法: node watchdog.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const FLEET_CONFIG_PATH = path.join(__dirname, '..', 'fleet-config.json');
const STATUS_FILE = path.join(__dirname, '..', 'shared', 'fleet-status.json');
const CHECK_INTERVAL = 60 * 1000; // 每分钟检查一次
const alerted = new Set(); // 已告警的 Agent，避免重复告警

function loadConfig() {
  return JSON.parse(fs.readFileSync(FLEET_CONFIG_PATH, 'utf8'));
}

function loadStatus() {
  if (!fs.existsSync(STATUS_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
}

function sendAlert(botToken, groupId, topicId, message) {
  const postData = JSON.stringify({
    chat_id: groupId,
    message_thread_id: parseInt(topicId),
    text: message,
    parse_mode: 'Markdown'
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${botToken}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  };

  const req = https.request(options);
  req.on('error', () => {});
  req.write(postData);
  req.end();
}

function check() {
  const config = loadConfig();
  const status = loadStatus();
  const now = Date.now();
  const timeout = (config.monitor?.heartbeat_timeout || 600) * 1000;

  const botToken = process.env.CLAW_BOT_TOKEN_ORCH || process.env.CLAW_BOT_TOKEN;
  const groupId = config.fleet.telegram.group_id;
  const alertTopicId = config.fleet.telegram.topics[config.monitor?.alert_channel || '指挥部'];

  let onlineCount = 0;
  let offlineAgents = [];

  for (const agent of config.agents) {
    const agentStatus = status[agent.id];

    if (!agentStatus) {
      // 从未报到
      if (!alerted.has(agent.id)) {
        offlineAgents.push(`🔴 *${agent.name}* (${agent.id}) — 从未上线`);
        alerted.add(agent.id);
      }
      continue;
    }

    const lastSeen = new Date(agentStatus.timestamp).getTime();
    const elapsed = now - lastSeen;

    if (elapsed > timeout) {
      // 超时
      const minutesAgo = Math.floor(elapsed / 60000);
      if (!alerted.has(agent.id)) {
        offlineAgents.push(`🔴 *${agent.name}* (${agent.id}) — 已掉线 ${minutesAgo} 分钟`);
        alerted.add(agent.id);
      }
    } else if (!agentStatus.gateway_alive) {
      // 在线但 Gateway 进程挂了
      if (!alerted.has(agent.id + '_gw')) {
        offlineAgents.push(`🟡 *${agent.name}* (${agent.id}) — 心跳正常但 Gateway 进程已停止`);
        alerted.add(agent.id + '_gw');
      }
    } else {
      // 正常
      onlineCount++;
      alerted.delete(agent.id);
      alerted.delete(agent.id + '_gw');
    }
  }

  // 发送告警
  if (offlineAgents.length > 0 && botToken && groupId && alertTopicId) {
    const alertMsg = `⚠️ *舰队告警*\n\n${offlineAgents.join('\n')}\n\n在线: ${onlineCount}/${config.agents.length}`;
    sendAlert(botToken, groupId, alertTopicId, alertMsg);
    console.log(`[${new Date().toISOString()}] ALERT sent: ${offlineAgents.length} agents offline`);
  }

  console.log(`[${new Date().toISOString()}] Check: ${onlineCount}/${config.agents.length} online`);
}

// ── 每日状态汇总 ──
function dailySummary() {
  const config = loadConfig();
  const status = loadStatus();
  const botToken = process.env.CLAW_BOT_TOKEN_ORCH || process.env.CLAW_BOT_TOKEN;
  const groupId = config.fleet.telegram.group_id;
  const topicId = config.fleet.telegram.topics['指挥部'];

  if (!botToken || !groupId || !topicId) return;

  let lines = [`📊 *每日舰队状态报告* — ${new Date().toLocaleDateString('zh-CN')}\n`];

  for (const agent of config.agents) {
    const s = status[agent.id];
    if (!s) {
      lines.push(`🔴 ${agent.name}: 未上线`);
    } else {
      const emoji = s.gateway_alive ? '🟢' : '🔴';
      const ver = s.openclaw_version || '?';
      const mem = s.system?.memory?.usage_percent || '?';
      const host = s.system?.hostname || '?';
      lines.push(`${emoji} ${agent.name}: ${host} | v${ver} | 内存${mem}%`);
    }
  }

  sendAlert(botToken, groupId, topicId, lines.join('\n'));
}

// ── 启动 ──
console.log('🦞 Fleet Watchdog started');
check();
setInterval(check, CHECK_INTERVAL);

// 每天早上9点发日报
const now = new Date();
const next9am = new Date(now);
next9am.setHours(9, 0, 0, 0);
if (next9am <= now) next9am.setDate(next9am.getDate() + 1);
const msUntil9am = next9am - now;
setTimeout(() => {
  dailySummary();
  setInterval(dailySummary, 24 * 60 * 60 * 1000);
}, msUntil9am);
