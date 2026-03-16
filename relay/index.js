#!/usr/bin/env node
// 龙虾舰队中继服务 — 双向转发：频道↔群组
const http = require('http');
const https = require('https');

// === 配置 ===
const RELAY_BOT_TOKEN = process.env.RELAY_BOT_TOKEN || '8799150974:AAFyzaiI8lAEGF-sxOggPl_YRCthQRqOjIo';
const HUB_BOT_TOKEN = 'REDACTED_BOT_TOKEN'; // 总控虾
const CHANNEL_ID = '-1003840752146';
const GROUP_ID = '-1003534331530';
const RELAY_BOT_ID = 8799150974;
const HUB_BOT_ID = 8329910550; // 总控虾 bot id

// 虾名 → 机器映射
const AGENTS = {
  '总控虾': { machine: 'rog', ip: '100.124.216.19', botToken: HUB_BOT_TOKEN, botId: HUB_BOT_ID, topic: 4 },
  '开发虾': { machine: 'macbook', ip: '100.87.148.50', botToken: 'REDACTED_BOT_TOKEN', botId: 8718744271, topic: 15 },
  '开发虾2': { machine: 'macmini', ip: '100.71.187.72', botToken: 'REDACTED_BOT_TOKEN', botId: 8279355404, topic: 15 },
  '新闻虾': { machine: 'macmini2', ip: '100.89.205.40', botToken: 'REDACTED_BOT_TOKEN', botId: 8359975375, topic: 6 },
  '社媒虾': { machine: 'p4', ip: '100.79.7.113', botToken: 'REDACTED_BOT_TOKEN', botId: 8661607664, topic: 4 },
  '视频虾': { machine: '4090', ip: '100.110.240.106', botToken: 'REDACTED_BOT_TOKEN', botId: 8743518007, topic: 11 },
};

// bot id → 虾名（用于识别群组里谁在回复）
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

// 发消息到频道（用 relay bot）
async function sendToChannel(text) {
  // 截断过长消息
  if (text.length > 4000) text = text.substring(0, 4000) + '\n...(截断)';
  return tgApi(RELAY_BOT_TOKEN, 'sendMessage', { chat_id: CHANNEL_ID, text });
}

// 用目标虾的 bot token 发消息到群组话题
async function sendToGroupTopic(botToken, threadId, text) {
  return tgApi(botToken, 'sendMessage', {
    chat_id: GROUP_ID,
    message_thread_id: threadId,
    text,
  });
}

// 解析指令：提取目标虾和任务内容
function parseCommand(text) {
  const targets = [];
  let taskText = text;

  // 匹配 @botusername
  const mentionRegex = /@(\w+)/g;
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    const username = match[1];
    if (BOT_USERNAMES[username]) {
      targets.push(BOT_USERNAMES[username]);
    }
    taskText = taskText.replace(match[0], '').trim();
  }

  // 匹配中文虾名（排除总控虾，它是指挥者不是执行者）
  for (const name of Object.keys(AGENTS)) {
    if (name === '总控虾') continue;
    if (text.includes(name) && !targets.includes(name)) {
      targets.push(name);
      taskText = taskText.replace(name, '').trim();
    }
  }

  // "全体" 广播（排除总控虾）
  if (targets.length === 0) {
    if (text.includes('全体') || text.includes('所有') || text.includes('广播')) {
      targets.push(...Object.keys(AGENTS).filter(n => n !== '总控虾'));
    }
  }

  return { targets, taskText: taskText.trim() || text };
}

// 转发指令到目标虾
async function relayCommand(targets, taskText) {
  if (targets.length === 0) {
    await sendToChannel('⚠️ 未识别目标虾。请写虾名（开发虾、新闻虾等）或用"全体"广播。');
    return;
  }

  const results = [];
  for (const name of targets) {
    const agent = AGENTS[name];
    if (!agent) continue;

    try {
      const sendResult = await sendToGroupTopic(
        agent.botToken,
        agent.topic,
        `📋 任务指令（来自指挥通道）\n\n${taskText}`
      );

      if (sendResult.ok) {
        results.push(`✅ ${name} (${agent.machine})`);
      } else {
        results.push(`❌ ${name}: ${sendResult.description}`);
      }
    } catch (err) {
      results.push(`❌ ${name}: ${err.message}`);
    }
  }

  await sendToChannel(`📡 指令已转发:\n${results.join('\n')}`);
}

// 处理频道消息（下行：频道→群组）
async function handleChannelPost(post) {
  if (String(post.chat.id) !== CHANNEL_ID) return;
  if (!post.text) return;

  const text = post.text;

  // 跳过 relay 自己发的消息（包含这些前缀的）
  if (text.startsWith('📡') || text.startsWith('⚠️') || text.startsWith('🦞') || text.startsWith('📨')) return;

  console.log(`[${ts()}] ⬇️ 频道指令: ${text.substring(0, 80)}`);

  const { targets, taskText } = parseCommand(text);
  await relayCommand(targets, taskText);
}

// 处理群组消息（上行：群组→频道，只转发 bot 的回复）
async function handleGroupMessage(msg) {
  if (String(msg.chat.id) !== GROUP_ID) return;
  if (!msg.from || !msg.from.is_bot) return; // 只转发 bot 消息
  if (msg.from.id === RELAY_BOT_ID) return; // 跳过 relay 自己

  const botName = BOT_ID_TO_NAME[msg.from.id];
  if (!botName) return; // 不认识的 bot 忽略

  // 跳过 relay 转发的任务指令（避免回环）
  if (msg.text && msg.text.startsWith('📋 任务指令')) return;

  const text = msg.text || '(非文本消息)';
  console.log(`[${ts()}] ⬆️ ${botName} 回复: ${text.substring(0, 80)}`);

  // 转发到频道，标注来源
  await sendToChannel(`📨 ${botName} 回复:\n${text}`);
}

function ts() { return new Date().toISOString(); }

// 主轮询循环
async function poll() {
  try {
    const res = await tgApi(RELAY_BOT_TOKEN, 'getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ['channel_post', 'message'],
    });

    if (res.ok && res.result.length > 0) {
      for (const update of res.result) {
        lastUpdateId = update.update_id;

        // 频道消息 → 下行转发
        if (update.channel_post) {
          await handleChannelPost(update.channel_post);
        }

        // 群组消息 → 上行转发回频道
        if (update.message) {
          await handleGroupMessage(update.message);
        }
      }
    }
  } catch (err) {
    console.error(`[${ts()}] 轮询错误:`, err.message);
  }

  setTimeout(poll, 100);
}

// === 启动 ===
async function main() {
  console.log('🦞 龙虾舰队中继服务 v2 启动');
  console.log(`频道: ${CHANNEL_ID} | 群组: ${GROUP_ID}`);
  console.log(`双向转发: 频道指令→群组 | 虾回复→频道`);
  console.log(`已注册 ${Object.keys(AGENTS).length} 只虾\n`);

  await sendToChannel('🦞 中继服务 v2 已上线（双向转发）\n\n⬇️ 频道指令 → 转发到群组话题\n⬆️ 虾回复 → 转发回频道\n\n用法：写虾名+任务，如「开发虾 安装OpenCode」');

  poll();
}

main().catch(console.error);
