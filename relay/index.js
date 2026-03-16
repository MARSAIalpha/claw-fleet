#!/usr/bin/env node
// ⚠️ 已废弃 — 改用 shared/skills/fleet-dispatch/dispatch.sh (SSH 直接调度)
// 龙虾舰队中继服务 v7 — 总控虾调度模式（不再使用）
// 流程: 用户→总控虾→DISPATCH指令→中继虾→SSH→目标虾→结果→总控虾→汇报
const https = require('https');
const path = require('path');
const { execFile } = require('child_process');

// === 配置 ===
const config = require(path.join(__dirname, 'config.json'));
const RELAY_BOT_TOKEN = process.env.RELAY_BOT_TOKEN || config.relay_bot_token;
const CHANNEL_ID = config.channel_id;
const GROUP_ID = config.group_id;
const AGENTS = config.agents;

let fleetConfig;
try {
  fleetConfig = require(path.join(__dirname, '..', 'fleet-config.json'));
} catch {
  fleetConfig = { machines: {} };
}

// 总控虾的 bot token（用于监听总控虾的消息）
const HUB_BOT_TOKEN = AGENTS['总控虾']?.botToken;
const HUB_BOT_ID = AGENTS['总控虾']?.botId;

function getMachineSSH(machineName) {
  const m = fleetConfig.machines?.[machineName];
  if (!m) return null;
  return { ip: m.tailscale_ip, user: m.ssh_user, platform: m.platform };
}

// 虾名→机器名 映射
const AGENT_MACHINE = {};
for (const [name, agent] of Object.entries(AGENTS)) {
  AGENT_MACHINE[name] = agent.machine;
}

let relayLastUpdateId = 0;
let hubLastUpdateId = 0;

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

async function sendToGroup(text, topicId) {
  if (text.length > 4000) text = text.substring(0, 4000) + '\n...(截断)';
  const body = { chat_id: GROUP_ID, text };
  if (topicId) body.message_thread_id = topicId;
  return tgApi(RELAY_BOT_TOKEN, 'sendMessage', body);
}

// === SSH 执行 openclaw agent ===
function sshExecAgent(machineName, message) {
  return new Promise((resolve, reject) => {
    const ssh = getMachineSSH(machineName);
    if (!ssh) return reject(new Error(`无SSH配置: ${machineName}`));

    const escapedMsg = message.replace(/'/g, "'\\''");
    let remoteCmd;
    if (ssh.platform === 'win32') {
      remoteCmd = `openclaw agent --agent main --channel telegram --deliver -m '${escapedMsg}'`;
    } else {
      remoteCmd = `export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH && openclaw agent --agent main --channel telegram --deliver -m '${escapedMsg}'`;
    }

    const args = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      '-o', 'ServerAliveInterval=30',
      `${ssh.user}@${ssh.ip}`,
      remoteCmd,
    ];

    console.log(`[${ts()}] 🔗 SSH → ${machineName} (${ssh.user}@${ssh.ip})`);

    execFile('ssh', args, { timeout: 180000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) {
        // fallback: tailscale ssh
        console.log(`[${ts()}] 🔄 SSH失败，尝试 tailscale ssh...`);
        execFile('tailscale', ['ssh', `${ssh.user}@${ssh.ip}`, remoteCmd],
          { timeout: 180000, maxBuffer: 1024 * 1024 }, (err2, stdout2) => {
            if (err2) reject(new Error(`SSH失败: ${err.message}`));
            else resolve(stdout2.trim());
          });
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

// === 解析总控虾回复中的 DISPATCH 指令 ===
function parseDispatchBlocks(text) {
  const blocks = [];
  const regex = /DISPATCH\s*\n([\s\S]*?)END_DISPATCH/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1];
    const target = block.match(/target:\s*(.+)/)?.[1]?.trim();
    const mode = block.match(/mode:\s*(.+)/)?.[1]?.trim() || 'exec';
    const task = block.match(/task:\s*([\s\S]*?)(?=\n(?:target|mode|$))/)?.[1]?.trim()
      || block.split('\n').filter(l => !l.match(/^(target|mode):/)).join('\n').trim();
    if (target && task) {
      blocks.push({ target, mode, task });
    }
  }
  return blocks;
}

// === 执行 DISPATCH 指令 ===
async function executeDispatch(dispatch) {
  const { target, mode, task } = dispatch;
  const agent = AGENTS[target];
  if (!agent) {
    await sendToChannel(`⚠️ 未找到目标: ${target}`);
    return null;
  }

  const machineName = agent.machine;
  const isEval = mode === 'eval';
  const modeLabel = isEval ? '📋评估' : '🚀执行';

  console.log(`[${ts()}] ${modeLabel} ${target}(${machineName}): ${task.substring(0, 50)}`);
  await sendToChannel(`${modeLabel} → ${target}(${machineName})\n任务: ${task.substring(0, 200)}`);

  const msg = isEval
    ? `📋【评估任务】我是${target}(${machineName})。请评估以下任务，不要开始编码：\n\n${task}\n\n请回复：1)身份 2)预计时间 3)技术方案 4)文件结构 5)难点`
    : `🚀【执行任务】我是${target}(${machineName})。请完成以下任务，完成后汇报结果：\n\n${task}`;

  try {
    const reply = await sshExecAgent(machineName, msg);
    const summary = reply.split('\n').slice(-30).join('\n');
    await sendToChannel(`📨 ${target}(${machineName}) 回复:\n${summary}`);
    return { target, machine: machineName, ok: true, reply: summary };
  } catch (err) {
    await sendToChannel(`❌ ${target}(${machineName}) 失败: ${err.message}`);
    return { target, machine: machineName, ok: false, error: err.message };
  }
}

// === 监听总控虾的 bot 消息（通过 getUpdates 拉取） ===
// 注意：这会和总控虾的 gateway 冲突（409），所以我们不直接 poll 总控虾的 token
// 改用方案：监听总控虾发到群组的消息（通过 relay bot 在群里看）
// 但 relay bot 也看不到其他 bot 的消息...
// 最终方案：通过 SSH 定期调用总控虾，让总控虾主动输出 DISPATCH

// === 处理用户消息（用户→总控虾→DISPATCH→执行）===
async function handleUserMessage(text, fromName) {
  console.log(`[${ts()}] 👤 用户消息 from ${fromName}: ${text.substring(0, 80)}`);

  // Step 1: 把用户消息转发给总控虾（通过 SSH）
  const hubMachine = AGENTS['总控虾']?.machine;
  if (!hubMachine) {
    await sendToChannel('⚠️ 总控虾未配置');
    return;
  }

  await sendToChannel(`📡 转发给总控虾: ${text.substring(0, 200)}`);

  try {
    const hubReply = await sshExecAgent(hubMachine,
      `[来自Simon的指令] ${text}\n\n请分析任务并用 DISPATCH 格式分配给合适的小龙虾。如果需要评估先用 mode: eval。`);

    console.log(`[${ts()}] 🦐 总控虾回复 (${hubReply.length} chars)`);

    // Step 2: 解析 DISPATCH 指令
    const dispatches = parseDispatchBlocks(hubReply);

    if (dispatches.length > 0) {
      console.log(`[${ts()}] 📋 解析到 ${dispatches.length} 条调度指令`);
      await sendToChannel(`🦐 总控虾分析完毕，派发 ${dispatches.length} 条任务`);

      // Step 3: 并行执行所有 DISPATCH
      const results = await Promise.all(dispatches.map(d => executeDispatch(d)));

      // Step 4: 收集结果发回总控虾
      const successResults = results.filter(r => r?.ok);
      if (successResults.length > 0) {
        const resultSummary = successResults
          .map(r => `【${r.target}/${r.machine}】\n${r.reply}`)
          .join('\n\n---\n\n');

        try {
          const reviewReply = await sshExecAgent(hubMachine,
            `[执行结果汇总] 以下是各虾的回复，请审核并给 Simon 一个总结：\n\n${resultSummary}`);
          const reviewSummary = reviewReply.split('\n').slice(-20).join('\n');
          await sendToChannel(`🦐 总控虾汇总:\n${reviewSummary}`);
          // 也发到群组指挥中心
          await sendToGroup(`🦐 总控虾汇总:\n${reviewSummary}`, 4);
        } catch (err) {
          await sendToChannel(`⚠️ 总控虾汇总失败: ${err.message}`);
        }
      }
    } else {
      // 没有 DISPATCH，可能总控虾直接回复了
      const hubSummary = hubReply.split('\n').slice(-20).join('\n');
      await sendToChannel(`🦐 总控虾回复:\n${hubSummary}`);
    }
  } catch (err) {
    await sendToChannel(`❌ 总控虾连接失败: ${err.message}\n请检查 macbook SSH 是否开启。`);
  }
}

// === 处理频道消息（用户在频道发指令） ===
async function handleChannelPost(post) {
  if (String(post.chat.id) !== CHANNEL_ID) return;
  if (!post.text) return;
  const text = post.text;
  // 忽略 relay 自己发的消息
  if (/^[📡⚠️🦞📨🦐❌✅🚀📋]/.test(text)) return;

  await handleUserMessage(text, '频道');
}

// === 处理群组消息（用户在群里@relay或提虾名） ===
async function handleGroupMessage(msg) {
  if (String(msg.chat.id) !== GROUP_ID) return;
  if (!msg.text) return;
  if (!msg.from || msg.from.is_bot) return;

  const text = msg.text;

  // 用户直接跟总控虾对话（@总控虾bot 或提到总控虾）
  if (/@ai395max_bot/.test(text) || text.includes('总控虾')) {
    // 这条消息已经会被总控虾的 gateway 处理（因为是人发的）
    // 但总控虾的 DISPATCH 回复我们看不到（bot-to-bot限制）
    // 所以这里不处理，让用户用频道来走完整链条
    return;
  }

  // 用户 @relay 或直接提虾名
  const hasMention = /@myclawrelaybot/.test(text);
  const hasTarget = Object.keys(AGENTS).some(n => text.includes(n));
  const hasBroadcast = /全体|所有|广播/.test(text);

  if (hasMention || hasBroadcast) {
    await handleUserMessage(text.replace(/@myclawrelaybot/g, '').trim(), msg.from.first_name);
  }
}

function ts() { return new Date().toISOString(); }

async function poll() {
  try {
    const res = await tgApi(RELAY_BOT_TOKEN, 'getUpdates', {
      offset: relayLastUpdateId + 1,
      timeout: 30,
      allowed_updates: ['channel_post', 'message'],
    });

    if (res.ok && res.result.length > 0) {
      console.log(`[${ts()}] 收到 ${res.result.length} 条更新`);
      for (const update of res.result) {
        relayLastUpdateId = update.update_id;
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
  console.log('🦞 龙虾舰队中继服务 v7 启动');
  console.log('模式: 用户→总控虾→DISPATCH→SSH→目标虾→结果→总控虾→汇报');
  console.log(`频道: ${CHANNEL_ID} | 群组: ${GROUP_ID}`);
  console.log(`总控虾: ${AGENTS['总控虾']?.machine || '未配置'}\n`);

  for (const [name, agent] of Object.entries(AGENTS)) {
    const ssh = getMachineSSH(agent.machine);
    console.log(`  ${name} → ${agent.machine} (${ssh ? `${ssh.user}@${ssh.ip}` : '⚠️ 无SSH'})`);
  }

  await sendToChannel(
    '🦞 中继服务 v7 已上线\n\n' +
    '📌 使用方式：在此频道发消息给总控虾\n' +
    '总控虾会自动分析、派任务、收结果、汇报\n\n' +
    '示例：让两个编程虾写一个计算器\n' +
    '示例：让编程虾评估一下做一个博客系统'
  );
  poll();
}

main().catch(console.error);
