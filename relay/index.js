#!/usr/bin/env node
// 龙虾舰队中继服务 v5 — 群组指令 + 频道调度 → 心跳命令服务
// 解决 bot-to-bot 不可见问题：relay 收集所有回复，转发给总控虾
const http = require('http');
const https = require('https');
const path = require('path');

// === 从配置文件加载 ===
const config = require(path.join(__dirname, 'config.json'));
const RELAY_BOT_TOKEN = process.env.RELAY_BOT_TOKEN || config.relay_bot_token;
const CHANNEL_ID = config.channel_id;
const GROUP_ID = config.group_id;
const AGENTS = config.agents;
const SIMON_USER_ID = '6346780385'; // Simon 的 Telegram ID

// bot id → 虾名
const BOT_ID_TO_NAME = {};
for (const [name, agent] of Object.entries(AGENTS)) {
  BOT_ID_TO_NAME[agent.botId] = name;
}

// bot username → 虾名
const BOT_USERNAMES = {
  'ai395max_bot': '总控虾',
  'macbookmarsainibot': '开发虾',
  'macbot1_bot': '开发虾2',
};

let lastUpdateId = 0;

// === Telegram API ===
function tgApi(token, method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch { resolve({ ok: false, description: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendToChannel(text) {
  if (text.length > 4000) text = text.substring(0, 4000) + '\n...(截断)';
  return tgApi(RELAY_BOT_TOKEN, 'sendMessage', { chat_id: CHANNEL_ID, text });
}

// 发消息到群组的指定 topic
async function sendToGroup(text, topicId) {
  if (text.length > 4000) text = text.substring(0, 4000) + '\n...(截断)';
  const body = { chat_id: GROUP_ID, text };
  if (topicId) body.message_thread_id = topicId;
  return tgApi(RELAY_BOT_TOKEN, 'sendMessage', body);
}

// === 通过心跳命令服务发送 agent 消息（端口 18790）===
function sendAgentMessage(ip, message) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      command: 'agent-message',
      message,
      replyTo: GROUP_ID,
    });
    const req = http.request({
      hostname: ip,
      port: 18790,
      path: '/api/command',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 130000,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch { resolve({ raw: buf, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

// 解析指令
function parseCommand(text) {
  const targets = [];
  let taskText = text;

  // @mention 解析
  const mentionRegex = /@(\w+)/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    if (BOT_USERNAMES[match[1]]) {
      targets.push(BOT_USERNAMES[match[1]]);
    }
    taskText = taskText.replace(match[0], '').trim();
  }

  // 虾名解析
  for (const name of Object.keys(AGENTS)) {
    if (name === '总控虾') continue;
    if (text.includes(name) && !targets.includes(name)) {
      targets.push(name);
      taskText = taskText.replace(name, '').trim();
    }
  }

  // 广播
  if (targets.length === 0) {
    if (text.includes('全体') || text.includes('所有') || text.includes('广播')) {
      targets.push(...Object.keys(AGENTS).filter(n => n !== '总控虾'));
    }
  }

  return { targets, taskText: taskText.trim() || text };
}

// 转发指令并收集回复
async function relayCommand(targets, taskText, source) {
  if (targets.length === 0) {
    const msg = '⚠️ 未识别目标虾。写虾名（开发虾、新闻虾等）或用"全体"广播。';
    await sendToChannel(msg);
    return;
  }

  console.log(`[${ts()}] 📡 转发 "${taskText.substring(0, 40)}" → ${targets.join(', ')}`);
  await sendToChannel(`📡 [${source}] 转发指令到 ${targets.join('、')}: ${taskText.substring(0, 100)}`);

  const results = [];
  const replies = [];

  for (const name of targets) {
    const agent = AGENTS[name];
    if (!agent) continue;

    try {
      const result = await sendAgentMessage(agent.ip, taskText);

      if (result.success) {
        results.push(`✅ ${name} (${agent.machine})`);
        if (result.message) {
          replies.push(`📨 ${name} 回复:\n${result.message}`);
        }
      } else {
        results.push(`⚠️ ${name} — ${result.message || '命令失败'}`);
      }
    } catch (err) {
      results.push(`❌ ${name} — ${err.message}`);
    }
  }

  // 发送结果到调度通道
  await sendToChannel(`📡 转发结果:\n${results.join('\n')}`);

  // 把回复转发到调度通道（总控虾可以在通道里看到）
  for (const reply of replies) {
    await sendToChannel(reply);
  }

  // 同时把回复转发给总控虾（通过 heartbeat agent-message）
  if (replies.length > 0) {
    const hubAgent = AGENTS['总控虾'];
    if (hubAgent) {
      const summary = replies.join('\n\n');
      try {
        await sendAgentMessage(hubAgent.ip,
          `[舰队回复汇总] 指令: "${taskText.substring(0, 50)}"\n\n${summary}`);
        console.log(`[${ts()}] 📨 回复已转发给总控虾`);
      } catch (err) {
        console.log(`[${ts()}] ⚠️ 转发给总控虾失败: ${err.message}`);
      }
    }
  }
}

// 处理频道消息（下行：频道指令→目标虾）
async function handleChannelPost(post) {
  if (String(post.chat.id) !== CHANNEL_ID) return;
  if (!post.text) return;
  const text = post.text;
  // 忽略 relay 自己发的消息
  if (text.startsWith('📡') || text.startsWith('⚠️') || text.startsWith('🦞') || text.startsWith('📨')) return;

  console.log(`[${ts()}] ⬇️ 频道指令: ${text.substring(0, 80)}`);
  const { targets, taskText } = parseCommand(text);
  await relayCommand(targets, taskText, '频道');
}

// 处理群组消息
async function handleGroupMessage(msg) {
  if (String(msg.chat.id) !== GROUP_ID) return;
  if (!msg.text) return;

  // 用户消息：如果包含虾名，当作调度指令
  if (msg.from && !msg.from.is_bot) {
    const text = msg.text;
    // 检查是否 @relay bot 或包含虾名
    const hasTarget = Object.keys(AGENTS).some(n => n !== '总控虾' && text.includes(n));
    const hasMention = /@myclawrelaybot/.test(text);
    const hasBroadcast = /全体|所有|广播/.test(text);

    if (hasTarget || hasMention || hasBroadcast) {
      console.log(`[${ts()}] ⬇️ 群组指令 from ${msg.from.first_name}: ${text.substring(0, 80)}`);
      const { targets, taskText } = parseCommand(text);
      await relayCommand(targets, taskText, msg.from.first_name);
      return;
    }
  }
}

function ts() { return new Date().toISOString(); }

async function poll() {
  try {
    const res = await tgApi(RELAY_BOT_TOKEN, 'getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ['channel_post', 'message'],
    });

    if (res.ok && res.result.length > 0) {
      console.log(`[${ts()}] 收到 ${res.result.length} 条更新`);
      for (const update of res.result) {
        lastUpdateId = update.update_id;
        if (update.channel_post) await handleChannelPost(update.channel_post);
        if (update.message) await handleGroupMessage(update.message);
      }
    }
  } catch (err) {
    console.error(`[${ts()}] 轮询错误:`, err.message);
  }
  setTimeout(poll, 100);
}

async function main() {
  console.log('🦞 龙虾舰队中继服务 v5 启动');
  console.log(`频道: ${CHANNEL_ID} | 群组: ${GROUP_ID}`);
  console.log(`模式: 群组+频道 → 心跳命令服务 → openclaw agent`);
  console.log(`已注册 ${Object.keys(AGENTS).length} 只虾\n`);

  await sendToChannel('🦞 中继服务 v5 已上线\n\n在群组或频道里写虾名+任务即可调度\n示例：开发虾 汇报状态\n示例：全体 ping');
  poll();
}

main().catch(console.error);
