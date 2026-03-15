#!/usr/bin/env node
/**
 * 小龙虾舰队控制面板 v3
 *
 * UI 参考 openclaw-control-center 的 Apple 风格设计:
 *   - 浅色玻璃态背景 + 圆角卡片
 *   - SF Pro 字体 + PingFang SC
 *   - badge 徽章状态 (ok/warn/over/info)
 *   - 侧边导航 + 多区域面板
 *
 * 数据来源: heartbeat.js 生成的 fleet-status.json
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.DASHBOARD_PORT || 3000;
const STATUS_FILE = path.join(__dirname, '..', 'shared', 'fleet-status.json');
const CONFIG_FILE = path.join(__dirname, '..', 'fleet-config.json');
const TIMEOUT_MS = 300 * 1000; // 5 分钟无心跳才判定离线（防止 Syncthing 延迟误判）

// 确保目录存在
const statusDir = path.dirname(STATUS_FILE);
if (!fs.existsSync(statusDir)) fs.mkdirSync(statusDir, { recursive: true });

function escHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── 主动 ping 缓存：后台定期 ping 每台机器的 18790 端口，避免 Syncthing 延迟导致误判离线 ──
const pingCache = {}; // { agentId: { alive: bool, ts: number } }
function backgroundPingAll() {
  const config = loadFleetConfig();
  if (!config?.machines) return;
  for (const [key, m] of Object.entries(config.machines)) {
    if (m.hidden) continue;
    const ip = m.tailscale_ip;
    if (!ip) continue;
    const agentId = m.agent_id || key;
    const url = `http://${ip}:18790/ping`;
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        pingCache[agentId] = { alive: true, ts: Date.now() };
      });
    });
    req.on('error', () => { pingCache[agentId] = { alive: false, ts: Date.now() }; });
    req.on('timeout', () => { req.destroy(); pingCache[agentId] = { alive: false, ts: Date.now() }; });
  }
}
// 每 30 秒 ping 一轮
setInterval(backgroundPingAll, 30000);
setTimeout(backgroundPingAll, 2000); // 启动 2 秒后首次 ping

function getAllStatus() {
  const now = Date.now();

  // 读取心跳数据（从 shared/heartbeats/*.json 独立文件读取，避免 Syncthing 冲突）
  let heartbeatData = {};
  const heartbeatsDir = path.join(statusDir, 'heartbeats');
  if (fs.existsSync(heartbeatsDir)) {
    try {
      for (const file of fs.readdirSync(heartbeatsDir).filter(f => f.endsWith('.json') && !f.startsWith('_') && !f.includes('.sync-conflict-'))) {
        try {
          let raw = fs.readFileSync(path.join(heartbeatsDir, file), 'utf8');
          if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
          const data = JSON.parse(raw);
          const agentId = data.agent_id || file.replace('.json', '');
          heartbeatData[agentId] = data;
        } catch (e) {}
      }
    } catch (e) {}
  }
  // 兼容旧的单文件格式
  if (Object.keys(heartbeatData).length === 0 && fs.existsSync(STATUS_FILE)) {
    try {
      let raw = fs.readFileSync(STATUS_FILE, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      heartbeatData = JSON.parse(raw);
    } catch (e) {}
  }

  // 读取 fleet-config 的 machines 列表（预期机器）
  const config = loadFleetConfig();
  const expectedMachines = (config && config.machines) ? config.machines : {};

  const result = [];
  const seen = new Set();

  // 1. 先处理有心跳数据的 agent（跳过 hidden 机器）
  for (const [id, a] of Object.entries(heartbeatData)) {
    const lastSeen = new Date(a.timestamp).getTime();
    const elapsed = now - lastSeen;
    const machineKey = Object.keys(expectedMachines).find(k =>
      expectedMachines[k].agent_id === id || k === id
    );
    const machineInfo = machineKey ? expectedMachines[machineKey] : null;
    if (machineInfo && machineInfo.hidden) { seen.add(id); if (machineKey) seen.add(machineKey); continue; }
    // 主动 ping 兜底：心跳文件超时但 ping 通 = 仍然在线（Syncthing 延迟）
    const fileOnline = elapsed < TIMEOUT_MS;
    const pingAlive = pingCache[id]?.alive && (now - (pingCache[id]?.ts || 0)) < 60000;
    result.push({
      ...a, id,
      online: fileOnline || pingAlive,
      elapsed,
      elapsedText: fmtElapsed(elapsed),
      expected: true,
      machine_label: machineInfo ? machineInfo.label : (a.agent_id || id)
    });
    seen.add(id);
    if (machineKey) seen.add(machineKey);
  }

  // 2. 补上 fleet-config 里有但没有心跳数据的机器（跳过 hidden）
  for (const [key, m] of Object.entries(expectedMachines)) {
    const agentId = m.agent_id || key;
    if (seen.has(key) || seen.has(agentId)) continue;
    if (m.hidden) continue;
    result.push({
      id: key,
      agent_id: agentId,
      timestamp: null,
      gateway_alive: false,
      online: false,
      elapsed: Infinity,
      elapsedText: '从未上线',
      expected: true,
      never_seen: true,
      machine_label: m.label || key,
      system: {
        hostname: m.hostname || '待配置',
        platform: m.platform || 'unknown',
        tailscale_ip: m.tailscale_ip || ''
      },
      openclaw: {}
    });
  }

  return result.sort((a, b) => {
    // 在线的排前面, 然后按名字
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (a.agent_id || a.id).localeCompare(b.agent_id || b.id);
  });
}

function fmtElapsed(ms) {
  if (ms < 60000) return Math.round(ms / 1000) + '秒前';
  if (ms < 3600000) return Math.round(ms / 60000) + '分钟前';
  if (ms < 86400000) return Math.round(ms / 3600000) + '小时前';
  return Math.round(ms / 86400000) + '天前';
}
function fmtBytes(b) { if (!b) return '-'; return b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB'; }
function fmtUptime(s) { if (!s) return '-'; const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60); return d>0?d+'d '+h+'h':h+'h '+m+'m'; }
function fmtTime(iso) {
  if (!iso) return '-';
  try { const d=Date.now()-new Date(iso).getTime(); return d<3600000?Math.round(d/60000)+'分钟前':d<86400000?Math.round(d/3600000)+'小时前':Math.round(d/86400000)+'天前'; } catch{ return '-'; }
}

function badge(status, label) {
  return `<span class="badge ${escHtml(status)}">${escHtml(label)}</span>`;
}

// 最新心跳版本号（与 heartbeat.js 的 HEARTBEAT_VERSION 一致）
const LATEST_HEARTBEAT_VERSION = 6;

function renderDashboard() {
  const agents = getAllStatus();
  const onlineCount = agents.filter(a => a.online && a.gateway_alive && a.telegram_reachable !== false).length;
  const tgBlockedCount = agents.filter(a => a.online && a.gateway_alive && a.telegram_reachable === false).length;
  const gwStoppedCount = agents.filter(a => a.online && !a.gateway_alive).length;
  const offlineCount = agents.filter(a => !a.online && !a.never_seen).length;
  const neverSeenCount = agents.filter(a => a.never_seen).length;
  const total = agents.length;
  const now = new Date().toLocaleString('zh-CN');

  // ── 汇总数据 ──
  let totalTokensToday = 0, totalCostToday = 0, totalRequestsToday = 0;
  let totalTokens30d = 0, totalCost30d = 0, totalRequests30d = 0;
  let totalSessions = 0, totalCronJobs = 0, totalSkills = 0;
  const versionSet = new Set();

  agents.forEach(a => {
    const oc = a.openclaw || {};
    const tu = oc.token_usage || {};
    if (tu.today) { totalTokensToday += tu.today.total || 0; totalCostToday += tu.today.cost || 0; totalRequestsToday += tu.today.requests || 0; }
    if (tu.days30) { totalTokens30d += tu.days30.total || 0; totalCost30d += tu.days30.cost || 0; totalRequests30d += tu.days30.requests || 0; }
    totalSessions += oc.sessions?.total || 0;
    totalCronJobs += Array.isArray(oc.cron_jobs) ? oc.cron_jobs.length : 0;
    totalSkills += (oc.skills || []).length;
    if (a.openclaw_version) {
      const m = (a.openclaw_version || '').match(/(\d+\.\d+\.\d+)/);
      if (m) versionSet.add(m[1]);
    }
  });

  function fmtTokens(n) { return n >= 1000000 ? (n/1000000).toFixed(1)+'M' : n >= 1000 ? (n/1000).toFixed(1)+'K' : String(n); }
  function fmtCost(n) { return n > 0 ? '$' + n.toFixed(3) : '$0'; }

  // ── 每台机器的展开详情 ──
  const machineRows = agents.map((a, idx) => {
    const isNever = a.never_seen;
    const isOk = a.online && a.gateway_alive;
    // telegram_reachable: true=可达 false=被墙 null/undefined=旧版心跳或GW未运行
    const tgBlocked = isOk && a.telegram_reachable === false;
    const gwStatus = isNever ? 'disabled' : (!a.online ? 'over' : (!a.gateway_alive ? 'warn' : (tgBlocked ? 'warn' : 'ok')));
    const gwLabel = isNever ? '待部署' : (!a.online ? '离线' : (!a.gateway_alive ? 'GW停止' : (tgBlocked ? 'TG断连' : '运行中')));
    const plat = a.system?.platform==='win32'?'Win':a.system?.platform==='darwin'?'Mac':a.system?.platform==='linux'?'Linux':'?';
    const memPct = a.system?.memory?.usage_percent || 0;
    const memTotal = a.system?.memory?.total ? Math.round(a.system.memory.total / 1024) + 'G' : '-';
    const memStatus = memPct > 85 ? 'over' : memPct > 70 ? 'warn' : 'ok';
    const label = a.machine_label || a.agent_id || a.id;
    const agentId = a.agent_id || a.id;
    const oc = a.openclaw || {};
    const tu = oc.token_usage || {};
    const todayTokens = tu.today?.total || 0;
    const todayCost = tu.today?.cost || 0;
    const todayReqs = tu.today?.requests || 0;

    // 操作按钮
    const actionBtns = isNever
      ? `<span class="meta">需先安装</span>`
      : (isOk
        ? `<button class="btn-action btn-danger" onclick="event.stopPropagation();sendCommand('${escHtml(agentId)}','restart')">重启</button>
           <button class="btn-action btn-warn" onclick="event.stopPropagation();sendCommand('${escHtml(agentId)}','stop')">停止</button>
           <button class="btn-action" onclick="event.stopPropagation();sendCommand('${escHtml(agentId)}','status')">状态</button>
           <button class="btn-action" onclick="event.stopPropagation();sendCommand('${escHtml(agentId)}','logs')">日志</button>`
        : `<button class="btn-action btn-ok" onclick="event.stopPropagation();sendCommand('${escHtml(agentId)}','start')">启动</button>
           <button class="btn-action" onclick="event.stopPropagation();sendCommand('${escHtml(agentId)}','doctor')">诊断</button>
           <button class="btn-action" onclick="event.stopPropagation();sendCommand('${escHtml(agentId)}','logs')">日志</button>`);

    // 行摘要
    const rowClass = isNever ? ' class="row-never"' : '';
    const row = `<tr${rowClass} class="machine-row ${isNever?'row-never':''}" data-agent="${escHtml(agentId)}" onclick="toggleDetail('detail-${idx}')" style="cursor:pointer">
      <td>
        <div class="agent-name">${escHtml(label)}</div>
        <div class="meta">${escHtml(agentId)} · ${escHtml(a.system?.hostname||'待配置')}${
          a.bot_config?.expected
            ? (a.bot_config.synced ? ' · <span style="color:var(--ok)">🤖已同步</span>' : ' · <span style="color:var(--over)">🤖未同步</span>')
            : ''
        }</div>
      </td>
      <td>${escHtml(plat)}</td>
      <td data-cell="status">${badge(gwStatus, gwLabel)}</td>
      <td data-cell="cpu">${isNever ? '-' : (a.system?.cpu_count||'?')+'核'}</td>
      <td data-cell="mem">${isNever ? '<span class="meta">-</span>' : `
        <div class="bar-row">
          <div class="bar-track"><div class="bar-fill ${memStatus}" style="width:${memPct}%"></div></div>
          <span class="bar-label">${memPct}% / ${memTotal}</span>
        </div>`}
      </td>
      <td data-cell="uptime">${isNever ? '-' : fmtUptime(a.system?.uptime)}</td>
      <td data-cell="tokens">${isNever ? '-' : fmtTokens(todayTokens)}</td>
      <td data-cell="elapsed">${a.elapsedText}</td>
      <td data-cell="hb-version">${isNever ? '-' :
        (a.heartbeat_version
          ? (a.heartbeat_version >= LATEST_HEARTBEAT_VERSION
            ? '<span style="color:var(--ok)">v'+a.heartbeat_version+' ✓</span>'
            : '<span style="color:var(--over)">v'+a.heartbeat_version+' <span title="最新 v'+LATEST_HEARTBEAT_VERSION+'">⟳</span></span>')
          : '<span style="color:var(--over)">旧版 ⟳</span>')
      }</td>
      <td class="action-cell" data-cell="actions">${actionBtns}</td>
    </tr>`;

    // ── 展开详情区域 ──
    if (isNever) {
      return row + `<tr class="detail-row" id="detail-${idx}" style="display:none"><td colspan="10">
        <div class="detail-panel"><p class="meta">此机器尚未部署心跳服务。请先在该机器上运行安装脚本。</p></div>
      </td></tr>`;
    }

    // 会话列表
    const sessList = oc.sessions?.list || [];
    const sessHtml = sessList.length > 0 ? `<table class="inner-table inner-table-sessions">
      <thead><tr><th>会话</th><th>渠道</th><th>模型</th><th>状态</th><th>最后活跃</th><th>上下文</th><th>文件大小</th></tr></thead>
      <tbody>${sessList.map(s => {
        const chIcon = s.channel==='telegram'?'TG':s.channel==='webchat'?'Web':s.channel||'?';
        const chBadge = s.channel==='telegram'?'info':s.channel==='webchat'?'ok':'disabled';
        const chatLabel = s.chatType==='group'?'群聊':s.chatType==='direct'?'私聊':s.chatType||'-';
        const modelStr = s.modelProvider&&s.model ? s.modelProvider+'/'+s.model : '-';
        const keyShort = (s.key||'').replace('agent:main:','');
        const elapsed = s.updatedAt ? Date.now() - new Date(s.updatedAt).getTime() : Infinity;
        const actBadge = elapsed<3600000?'live':elapsed<86400000?'idle':'off';
        const actLabel = elapsed<3600000?'活跃':elapsed<86400000?'空闲':'不活跃';
        return `<tr>
          <td><div class="agent-name" style="font-size:12px">${escHtml(keyShort)}</div></td>
          <td>${badge(chBadge, chIcon)} <span class="meta">${escHtml(chatLabel)}</span></td>
          <td><code class="model-code">${escHtml(modelStr)}</code></td>
          <td>${badge(actBadge, actLabel)}</td>
          <td>${fmtTime(s.updatedAt)}</td>
          <td>${s.contextTokens?Math.round(s.contextTokens/1000)+'K':'-'}</td>
          <td>${fmtBytes(s.fileSize)}</td>
        </tr>`;
      }).join('')}</tbody></table>` : '<p class="meta">暂无会话</p>';

    // Cron 任务
    const cronList = Array.isArray(oc.cron_jobs) ? oc.cron_jobs : [];
    const cronHtml = cronList.length > 0 ? `<table class="inner-table">
      <thead><tr><th>任务名</th><th>调度</th><th>状态</th><th>描述</th><th>上次执行</th></tr></thead>
      <tbody>${cronList.map(j => {
        const hBadge = !j.enabled?'disabled':(j.nextRunAt?'ok':'idle');
        const hLabel = !j.enabled?'已禁用':(j.nextRunAt?'已排期':'等待中');
        return `<tr>
          <td><div class="agent-name" style="font-size:12px">${escHtml(j.name)}</div></td>
          <td><code class="model-code secondary">${escHtml(j.schedule||'-')}</code></td>
          <td>${badge(hBadge, hLabel)}</td>
          <td class="meta">${escHtml(j.description||'-')}</td>
          <td>${fmtTime(j.lastRunAt)}</td>
        </tr>`;
      }).join('')}</tbody></table>` : '<p class="meta">暂无 Cron 定时任务</p>';

    // 技能
    const skills = oc.skills || [];
    const skillHtml = skills.length > 0 ? `<div class="skill-grid">${skills.map(sk => {
      const srcBadge = sk.source==='openclaw-bundled'?'info':sk.source==='openclaw-workspace'?'ok':'disabled';
      const srcLabel = sk.source==='openclaw-bundled'?'内置':sk.source==='openclaw-workspace'?'工作区':sk.source||'?';
      return `<div class="skill-chip">${badge(srcBadge, srcLabel)} <span>${escHtml(sk.name)}</span></div>`;
    }).join('')}</div>` : '<p class="meta">暂无技能</p>';

    // Token 使用
    const t30 = tu.days30 || {};
    const tokenHtml = `<div class="token-grid">
      <div class="token-item"><div class="ov-value" style="font-size:18px">${fmtTokens(todayTokens)}</div><div class="meta">今日 Token</div></div>
      <div class="token-item"><div class="ov-value" style="font-size:18px">${fmtCost(todayCost)}</div><div class="meta">今日费用</div></div>
      <div class="token-item"><div class="ov-value" style="font-size:18px">${todayReqs}</div><div class="meta">今日请求</div></div>
      <div class="token-item"><div class="ov-value" style="font-size:18px">${fmtTokens(t30.total||0)}</div><div class="meta">30天 Token</div></div>
      <div class="token-item"><div class="ov-value" style="font-size:18px">${fmtCost(t30.cost||0)}</div><div class="meta">30天费用</div></div>
      <div class="token-item"><div class="ov-value" style="font-size:18px">${t30.requests||0}</div><div class="meta">30天请求</div></div>
    </div>`;

    // 模型 & 认证
    const pm = oc.primary_model || '-';
    const profiles = Object.entries(oc.auth_profiles || {});
    const stats = oc.usage_stats || {};
    const modelHtml = `<div style="display:flex;gap:24px;flex-wrap:wrap">
      <div><div class="meta">主模型</div><code class="model-code">${escHtml(pm)}</code></div>
      <div><div class="meta">模型数</div><strong>${(oc.models||[]).length}</strong></div>
      <div><div class="meta">记忆DB</div><strong>${fmtBytes(oc.memory_db_size)}</strong></div>
      <div><div class="meta">版本</div><span class="meta">${escHtml(a.openclaw_version||'-')}</span></div>
    </div>
    ${profiles.length > 0 ? `<div style="margin-top:10px">${profiles.map(([name,p]) => {
      const s = stats[name]||{};
      const errCount = s.errorCount||0;
      const errB = errCount>0?badge('over','err:'+errCount):badge('ok','ok');
      return `<div class="profile-row"><span class="profile-provider">${escHtml(p.provider)}</span><span class="profile-type">${escHtml(p.type)}</span>${errB}<span class="meta">${fmtTime(s.lastUsed)}</span></div>`;
    }).join('')}</div>` : ''}`;

    // Soul & 记忆（仅本机的两个文件）
    const soulF = oc.soul_file;
    const memF = oc.memory_file;
    const hasSoulData = soulF || memF;
    const soulMemHtml = hasSoulData ? `<table class="inner-table inner-table-soul">
      <thead><tr><th>文件</th><th>路径</th><th>操作</th></tr></thead>
      <tbody>
        ${soulF ? `<tr>
          <td>${badge('info','Soul')} <strong>${escHtml(soulF.label)}</strong></td>
          <td class="meta">${escHtml(soulF.relativePath)}</td>
          <td><button class="btn-action btn-ok" onclick="event.stopPropagation();saveConfigFile('${escHtml(agentId)}','soul',this)">保存</button></td>
        </tr>
        <tr><td colspan="3" style="padding:0">
          <textarea class="config-editor" data-agent="${escHtml(agentId)}" data-file-id="soul" spellcheck="false">${escHtml(soulF.content||'')}</textarea>
        </td></tr>` : ''}
        ${memF ? `<tr>
          <td>${badge('ok','Memory')} <strong>${escHtml(memF.label)}</strong></td>
          <td class="meta">${escHtml(memF.relativePath)}</td>
          <td><button class="btn-action btn-ok" onclick="event.stopPropagation();saveConfigFile('${escHtml(agentId)}','memory',this)">保存</button></td>
        </tr>
        <tr><td colspan="3" style="padding:0">
          <textarea class="config-editor" data-agent="${escHtml(agentId)}" data-file-id="memory" spellcheck="false" placeholder="在此输入本机记忆内容...">${escHtml(memF.content||'')}</textarea>
        </td></tr>` : ''}
      </tbody>
    </table>` : '<p class="meta">暂无数据（需重启心跳服务）</p>';

    return row + `<tr class="detail-row" id="detail-${idx}" style="display:none"><td colspan="10">
      <div class="detail-panel">
        <div class="detail-tabs">
          <span class="detail-tab active" onclick="switchDetailTab(${idx},'sessions',this)">会话 (${sessList.length})</span>
          <span class="detail-tab" onclick="switchDetailTab(${idx},'soul',this)">Soul & 记忆</span>
          <span class="detail-tab" onclick="switchDetailTab(${idx},'cron',this)">Cron (${cronList.length})</span>
          <span class="detail-tab" onclick="switchDetailTab(${idx},'tokens',this)">Token 用量</span>
          <span class="detail-tab" onclick="switchDetailTab(${idx},'skills',this)">技能 (${skills.length})</span>
          <span class="detail-tab" onclick="switchDetailTab(${idx},'model',this)">模型 & 认证</span>
        </div>
        <div class="detail-body">
          <div class="detail-content active" id="detail-${idx}-sessions">${sessHtml}</div>
          <div class="detail-content" id="detail-${idx}-soul">${soulMemHtml}</div>
          <div class="detail-content" id="detail-${idx}-cron">${cronHtml}</div>
          <div class="detail-content" id="detail-${idx}-tokens">${tokenHtml}</div>
          <div class="detail-content" id="detail-${idx}-skills">${skillHtml}</div>
          <div class="detail-content" id="detail-${idx}-model">${modelHtml}</div>
        </div>
      </div>
    </td></tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>小龙虾舰队控制面板</title>
  <style>
    :root {
      --bg: #eef2f6; --panel: #ffffff;
      --surface-1: rgba(255,255,255,0.98); --surface-2: rgba(252,253,255,0.94);
      --border: rgba(17,24,39,0.09); --border-soft: rgba(17,24,39,0.06); --border-strong: rgba(17,24,39,0.14);
      --text: #1d1d1f; --muted: #6e6e73;
      --ok: #248a3d; --warn: #b57f10; --over: #d23f31; --info: #0071e3;
      --shadow-card: 0 14px 30px rgba(15,23,42,0.05), 0 2px 8px rgba(15,23,42,0.03);
      --shadow-hover: 0 20px 42px rgba(15,23,42,0.08), 0 4px 14px rgba(15,23,42,0.04);
      --radius-lg: 20px; --radius-md: 14px; --radius-sm: 10px;
      --card-fill: linear-gradient(180deg, rgba(255,255,255,0.99), rgba(250,251,253,0.975) 56%, rgba(244,247,251,0.95));
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "SF Pro Display","SF Pro Text",-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif;
      color: var(--text); font-size: 14px; line-height: 1.58; min-height: 100vh;
      background: radial-gradient(circle at 8% -10%, rgba(164,192,230,0.22), transparent 34%),
        radial-gradient(circle at 96% 0%, rgba(218,226,240,0.18), transparent 32%),
        linear-gradient(180deg, #f3f5f8 0%, #e9edf3 46%, #e5eaf0 100%);
      -webkit-font-smoothing: antialiased;
    }
    .shell { max-width: 1280px; margin: 0 auto; padding: 28px 24px; }
    .header { display: flex; align-items: baseline; gap: 12px; }
    .header h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
    .header-actions { display: flex; gap: 8px; margin-left: auto; }
    .btn-fleet-update, .btn-version-check {
      padding: 6px 14px; font-size: 12px; font-weight: 600;
      border: 1px solid rgba(0,113,227,0.25); border-radius: 8px;
      background: rgba(0,113,227,0.06); color: var(--info); cursor: pointer;
      transition: all 150ms ease;
    }
    .btn-fleet-update:hover, .btn-version-check:hover { background: rgba(0,113,227,0.12); }
    .header-sub { font-size: 12px; color: var(--muted); margin-bottom: 20px; }
    .update-banner {
      background: rgba(0,113,227,0.06); border: 1px solid rgba(0,113,227,0.2);
      border-radius: var(--radius-sm); padding: 10px 16px; margin-bottom: 16px;
      font-size: 13px; color: var(--info); display: flex; align-items: center;
    }

    /* ── 概览卡片 ── */
    .overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .overview-card {
      background: var(--card-fill); border: 1px solid var(--border); border-radius: var(--radius-md);
      padding: 16px 18px; box-shadow: var(--shadow-card); transition: transform 180ms ease;
    }
    .overview-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); }
    .overview-card .ov-value { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
    .overview-card .ov-label { font-size: 11px; color: var(--muted); margin-top: 4px; }
    .ov-ok { color: var(--ok); } .ov-over { color: var(--over); } .ov-info { color: var(--info); } .ov-text { color: var(--text); }

    /* ── 主卡片 ── */
    .card {
      background: var(--card-fill); border: 1px solid var(--border); border-radius: var(--radius-lg);
      padding: 20px 22px; box-shadow: var(--shadow-card); overflow-x: auto;
    }
    .card h2 { font-size: 16px; font-weight: 600; margin-bottom: 14px; letter-spacing: -0.01em; }
    .section-blurb { font-size: 12px; color: var(--muted); margin-top: -10px; margin-bottom: 14px; }

    /* ── 表格 ── */
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    thead th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-strong); color: var(--muted); font-weight: 500; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
    tbody td { padding: 10px 10px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; }
    .machine-row:hover td { background: rgba(0,113,227,0.03); }
    .machine-row td:first-child::before { content: '▸ '; color: var(--muted); font-size: 10px; }
    .machine-row.expanded td:first-child::before { content: '▾ '; }

    /* ── Badge ── */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; line-height: 1.5; border: 1px solid transparent; white-space: nowrap; }
    .badge.ok, .badge.done { color: #1d7435; border-color: rgba(36,138,61,0.3); background: rgba(238,251,242,0.95); }
    .badge.warn { color: #94680e; border-color: rgba(181,127,16,0.32); background: rgba(255,248,232,0.95); }
    .badge.over, .badge.error { color: #b53125; border-color: rgba(210,63,49,0.34); background: rgba(255,240,238,0.95); }
    .badge.info, .badge.active, .badge.live { color: #0059b4; border-color: rgba(0,113,227,0.32); background: rgba(236,246,255,0.95); }
    .badge.disabled, .badge.idle, .badge.off { color: #666a70; border-color: rgba(125,129,136,0.3); background: rgba(248,248,249,0.95); }

    /* ── 进度条 ── */
    .bar-row { display: flex; align-items: center; gap: 8px; }
    .bar-track { flex:0 0 60px; border: 1px solid rgba(17,24,39,0.1); border-radius: 999px; height: 7px; background: rgba(227,230,236,0.62); overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 999px; } .bar-fill.ok { background: #18a97a; } .bar-fill.warn { background: #d69a1d; } .bar-fill.over { background: #cc4545; }
    .bar-label { font-size: 11px; color: var(--muted); white-space: nowrap; }
    .agent-name { font-weight: 600; font-size: 13px; } .meta { font-size: 11px; color: var(--muted); }
    .model-code { font-family: "SF Mono","Fira Code",monospace; font-size: 11px; background: rgba(0,113,227,0.06); padding: 2px 6px; border-radius: 5px; color: #0059b4; }
    .model-code.secondary { background: rgba(0,0,0,0.04); color: var(--muted); }
    .profile-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 12px; }
    .profile-row:not(:last-child) { border-bottom: 1px solid var(--border-soft); }
    .profile-provider { font-weight: 600; min-width: 70px; }
    .profile-type { font-size: 10px; color: var(--muted); padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.04); }

    /* ── 按钮 ── */
    .btn-action { padding: 4px 10px; border: 1px solid var(--border-strong); border-radius: 7px; background: var(--surface-1); color: var(--muted); cursor: pointer; font-size: 11px; font-weight: 500; transition: all 150ms ease; }
    .btn-action:hover { background: rgba(0,113,227,0.06); color: var(--info); border-color: rgba(0,113,227,0.3); }
    .btn-action.btn-danger:hover { background: rgba(210,63,49,0.08); color: var(--over); }
    .btn-action.btn-ok { background: rgba(36,138,61,0.08); color: var(--ok); border-color: rgba(36,138,61,0.25); font-weight: 600; }
    .btn-action.btn-ok:hover { background: rgba(36,138,61,0.15); }
    .btn-action.btn-warn:hover { background: rgba(181,127,16,0.08); color: var(--warn); }
    .action-cell { white-space: nowrap; } .action-cell .btn-action { margin-right: 4px; }

    /* ── 展开详情 ── */
    .detail-row td { padding: 0 !important; border-bottom: 2px solid var(--border); }
    .detail-panel { padding: 20px 24px; background: rgba(248,249,252,0.9); }
    .detail-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
    .detail-tab { padding: 9px 18px; font-size: 12px; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; font-weight: 500; transition: color 150ms, border-color 150ms; user-select: none; }
    .detail-tab:hover { color: var(--text); }
    .detail-tab.active { color: var(--info); border-bottom-color: var(--info); }
    .detail-body { position: relative; min-height: 220px; }
    .detail-content { display: none; }
    .detail-content.active { display: block; }
    .inner-table { font-size: 12px; width: 100%; table-layout: fixed; }
    .inner-table thead th { font-size: 10px; padding: 6px 10px; overflow: hidden; text-overflow: ellipsis; }
    .inner-table tbody td { padding: 7px 10px; overflow: hidden; text-overflow: ellipsis; }
    .inner-table-sessions th:nth-child(1) { width: 28%; }
    .inner-table-sessions th:nth-child(2) { width: 12%; }
    .inner-table-sessions th:nth-child(3) { width: 22%; }
    .inner-table-sessions th:nth-child(4) { width: 8%; }
    .inner-table-sessions th:nth-child(5) { width: 12%; }
    .inner-table-sessions th:nth-child(6) { width: 9%; }
    .inner-table-sessions th:nth-child(7) { width: 9%; }

    /* ── 技能网格 ── */
    .skill-grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 0; }
    .skill-chip { display: flex; align-items: center; gap: 6px; padding: 5px 12px; background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; font-size: 12px; }

    /* ── Soul/Memory 编辑器 ── */
    .config-editor {
      width: 100%; min-height: 200px; max-height: 420px; padding: 12px 14px; border: none; resize: vertical;
      font-family: "SF Mono","Fira Code","Cascadia Code",monospace; font-size: 12px; line-height: 1.65;
      background: rgba(250,251,253,0.95); color: var(--text); outline: none; tab-size: 2;
      border-top: 1px solid var(--border-soft);
    }
    .config-editor:focus { background: #fff; box-shadow: inset 0 0 0 2px rgba(0,113,227,0.15); }
    .save-ok { animation: saveFlash 1s ease; }
    @keyframes saveFlash { 0%{background:rgba(36,138,61,0.12)} 100%{background:rgba(36,138,61,0)} }
    .inner-table-soul th:nth-child(1) { width: 30%; }
    .inner-table-soul th:nth-child(2) { width: 50%; }
    .inner-table-soul th:nth-child(3) { width: 20%; text-align: right; }
    .inner-table-soul td:nth-child(3) { text-align: right; }

    /* ── Token 网格 ── */
    .token-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 4px 0; }
    .token-item { text-align: center; padding: 16px 12px; background: var(--surface-1); border: 1px solid var(--border); border-radius: var(--radius-sm); }

    /* ── 命令结果 ── */
    .result-panel { display: none; margin-top: 16px; background: var(--card-fill); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 14px 18px; box-shadow: var(--shadow-card); }
    .result-panel.visible { display: block; }
    .result-panel .result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .result-panel .result-title { font-size: 13px; font-weight: 600; }
    .result-panel .result-close { cursor: pointer; font-size: 16px; color: var(--muted); border: none; background: none; }
    .result-panel .result-body { font-family: "SF Mono",monospace; font-size: 12px; line-height: 1.6; background: rgba(0,0,0,0.03); padding: 10px 14px; border-radius: 8px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
    .result-panel .result-body.error { color: var(--over); background: rgba(210,63,49,0.05); }
    .row-never td { opacity: 0.55; } .row-never:hover td { opacity: 0.85; }
    .toast { position: fixed; bottom: 20px; right: 20px; background: var(--panel); border: 1px solid var(--border); padding: 10px 18px; border-radius: var(--radius-sm); box-shadow: 0 8px 24px rgba(15,23,42,0.06); display: none; font-size: 13px; z-index: 100; }
    .footer { text-align: center; padding: 16px; font-size: 11px; color: var(--muted); margin-top: 20px; }

    /* ── 守护犬告警横幅 ── */
    .watchdog-banner { padding: 10px 16px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
    .watchdog-banner.level-error { background: rgba(210,63,49,0.08); border: 1px solid rgba(210,63,49,0.2); color: var(--over); }
    .watchdog-banner.level-warning { background: rgba(234,179,8,0.08); border: 1px solid rgba(234,179,8,0.2); color: #b45309; }
    .watchdog-banner.level-ok { background: rgba(34,197,94,0.08); border: 1px solid rgba(34,197,94,0.2); color: var(--ok); }
    .watchdog-banner .dismiss { margin-left: auto; cursor: pointer; border: none; background: none; font-size: 16px; opacity: 0.5; }
    .watchdog-banner .dismiss:hover { opacity: 1; }

    /* ── 24h 运行报告 ── */
    .report-24h { margin-top: 12px; background: var(--card-fill); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
    .report-24h-header { padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; }
    .report-24h-header:hover { background: var(--surface-1); }
    .report-24h-header .arrow { transition: transform 0.2s; font-size: 11px; }
    .report-24h-header .arrow.open { transform: rotate(90deg); }
    .report-24h-body { display: none; padding: 0 16px 14px; }
    .report-24h-body.open { display: block; }
    .report-timeline { font-size: 12px; line-height: 1.8; }
    .report-timeline .entry { display: flex; gap: 10px; padding: 3px 0; border-bottom: 1px solid var(--border); }
    .report-timeline .entry:last-child { border-bottom: none; }
    .report-timeline .entry-time { color: var(--muted); font-family: "SF Mono",monospace; white-space: nowrap; min-width: 60px; }
    .report-timeline .entry-icon { min-width: 18px; text-align: center; }
    .report-timeline .entry-msg { flex: 1; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header">
      <h1>小龙虾舰队</h1>
      <div class="header-actions">
        <button class="btn-action btn-version-check" onclick="checkLatestVersion()" title="检查 npm 最新版本">检查更新</button>
        <button class="btn-action btn-fleet-update" onclick="fleetUpdate(true)" title="更新所有节点并重启 Gateway">全舰队更新</button>
      </div>
    </div>
    <div class="header-sub" id="headerSub">更新于 ${now} · 每 15 秒自动刷新 · ${escHtml([...versionSet].join(', ')||'-')}</div>

    <div id="updateBanner" class="update-banner" style="display:none"></div>
    <div id="watchdogBanner" class="watchdog-banner" style="display:none"></div>

    <div class="overview-grid" id="overviewGrid">
      <div class="overview-card">
        <div class="ov-value ov-ok" id="ov-online">${onlineCount}</div>
        <div class="ov-label">运行中 / <span id="ov-total">${total}</span> 台</div>
      </div>
      <div class="overview-card">
        <div class="ov-value ov-info" id="ov-sessions">${totalSessions}</div>
        <div class="ov-label">活跃会话</div>
      </div>
      <div class="overview-card">
        <div class="ov-value ov-text" id="ov-cron">${totalCronJobs}</div>
        <div class="ov-label">Cron 任务</div>
      </div>
      <div class="overview-card">
        <div class="ov-value ov-info" id="ov-tokens-today">${fmtTokens(totalTokensToday)}</div>
        <div class="ov-label">今日 Token · <span id="ov-cost-today">${fmtCost(totalCostToday)}</span></div>
      </div>
      <div class="overview-card">
        <div class="ov-value ov-text" id="ov-tokens-30d">${fmtTokens(totalTokens30d)}</div>
        <div class="ov-label">30天 Token · <span id="ov-cost-30d">${fmtCost(totalCost30d)}</span></div>
      </div>
      <div class="overview-card">
        <div class="ov-value ${(offlineCount+gwStoppedCount+tgBlockedCount)>0?'ov-over':'ov-text'}" id="ov-abnormal">${offlineCount+gwStoppedCount+tgBlockedCount}</div>
        <div class="ov-label">异常 / 停止</div>
      </div>
    </div>

    <div class="report-24h">
      <div class="report-24h-header" onclick="toggleWatchdogReport()">
        <span id="watchdogArrow" class="arrow">▶</span>
        🐕 守护犬运行报告
        <span class="meta" style="margin-left:auto">点击展开</span>
      </div>
      <div id="watchdogReportBody" class="report-24h-body">
        <div class="meta" style="padding:8px 0">加载中...</div>
      </div>
    </div>

    <div class="card">
      <h2>运行状态</h2>
      <div class="section-blurb">点击机器行展开查看会话、Cron、Token 用量、技能详情</div>
      <table>
        <thead><tr>
          <th>名称 / 主机</th><th>系统</th><th>状态</th><th>CPU</th>
          <th>内存</th><th>运行</th><th>今日Token</th><th>心跳</th><th>HB版本</th><th>操作</th>
        </tr></thead>
        <tbody>${machineRows}</tbody>
      </table>
    </div>

    <div class="footer">小龙虾舰队 v4 · Syncthing + Tailscale · 参考 openclaw-control-center</div>
  </div>

  <div class="result-panel" id="resultPanel">
    <div class="result-header">
      <span class="result-title" id="resultTitle">命令结果</span>
      <button class="result-close" onclick="closeResult()">&times;</button>
    </div>
    <div class="result-body" id="resultBody"></div>
  </div>
  <div class="toast" id="toast"></div>

  <script>
    let cmdRunning = false;

    // ── AJAX 局部刷新（不再整页 reload）──
    function fmtTokensJS(n) { return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); }
    function fmtUptimeJS(s) {
      if (!s || s <= 0) return '-';
      const d = Math.floor(s/86400), h = Math.floor((s%86400)/3600), m = Math.floor((s%3600)/60);
      return d > 0 ? d+'d '+h+'h' : h+'h '+m+'m';
    }
    function badgeHTML(status, label) {
      return '<span class="badge badge-'+status+'">'+label+'</span>';
    }

    function refreshData() {
      if (cmdRunning) return;
      fetch('/api/dashboard-data').then(r=>r.json()).then(data => {
        // 更新时间
        const sub = document.getElementById('headerSub');
        if (sub) sub.textContent = '更新于 ' + data.now + ' · 每 15 秒自动刷新';

        // 更新概览卡片
        const ov = data.overview;
        const el = id => document.getElementById(id);
        if (el('ov-online')) el('ov-online').textContent = ov.onlineCount;
        if (el('ov-total')) el('ov-total').textContent = ov.total;
        if (el('ov-sessions')) el('ov-sessions').textContent = ov.totalSessions;
        if (el('ov-cron')) el('ov-cron').textContent = ov.totalCronJobs;
        if (el('ov-tokens-today')) el('ov-tokens-today').textContent = ov.totalTokensToday;
        if (el('ov-cost-today')) el('ov-cost-today').textContent = ov.totalCostToday;
        if (el('ov-tokens-30d')) el('ov-tokens-30d').textContent = ov.totalTokens30d;
        if (el('ov-cost-30d')) el('ov-cost-30d').textContent = ov.totalCost30d;
        if (el('ov-abnormal')) {
          el('ov-abnormal').textContent = ov.abnormal;
          el('ov-abnormal').className = 'ov-value ' + (ov.abnormal > 0 ? 'ov-over' : 'ov-text');
        }

        // 更新每台机器的行数据（不动展开区域）
        data.machines.forEach(m => {
          const row = document.querySelector('tr.machine-row[data-agent="'+m.agentId+'"]');
          if (!row) return;

          // 状态 badge
          const statusCell = row.querySelector('[data-cell="status"]');
          if (statusCell) statusCell.innerHTML = badgeHTML(m.gwStatus, m.gwLabel);

          // 内存
          const memCell = row.querySelector('[data-cell="mem"]');
          if (memCell && !m.isNever) {
            memCell.innerHTML = '<div class="bar-row"><div class="bar-track"><div class="bar-fill '+m.memStatus+'" style="width:'+m.memPct+'%"></div></div><span class="bar-label">'+m.memPct+'% / '+m.memTotal+'</span></div>';
          }

          // 运行时间
          const uptimeCell = row.querySelector('[data-cell="uptime"]');
          if (uptimeCell && !m.isNever) uptimeCell.textContent = fmtUptimeJS(m.uptime);

          // Token
          const tokenCell = row.querySelector('[data-cell="tokens"]');
          if (tokenCell && !m.isNever) tokenCell.textContent = fmtTokensJS(m.todayTokens);

          // 心跳时间
          const elapsedCell = row.querySelector('[data-cell="elapsed"]');
          if (elapsedCell) elapsedCell.textContent = m.elapsed;

          // HB版本
          const versionCell = row.querySelector('[data-cell="hb-version"]');
          if (versionCell && !m.isNever) {
            versionCell.innerHTML = m.hbVersion
              ? (m.hbVersion >= m.latestVersion
                ? '<span style="color:#22c55e">v'+m.hbVersion+' ✓</span>'
                : '<span style="color:#d23f31">v'+m.hbVersion+' <span title="最新 v'+m.latestVersion+'">⟳</span></span>')
              : '<span style="color:#d23f31">旧版 ⟳</span>';
          }

          // 操作按钮（状态可能变化，需要更新）
          const actionsCell = row.querySelector('[data-cell="actions"]');
          if (actionsCell && !m.isNever) {
            const aid = m.agentId;
            function cmdBtn(cls, cmd, label) {
              return '<button class="btn-action '+cls+'" onclick="event.stopPropagation();sendCommand(&#39;'+aid+'&#39;,&#39;'+cmd+'&#39;)">'+label+'</button>';
            }
            if (m.isOk) {
              actionsCell.innerHTML = cmdBtn('btn-danger','restart','重启')+' '+cmdBtn('btn-warn','stop','停止')+' '+cmdBtn('','status','状态')+' '+cmdBtn('','logs','日志');
            } else {
              actionsCell.innerHTML = cmdBtn('btn-ok','start','启动')+' '+cmdBtn('','doctor','诊断')+' '+cmdBtn('','logs','日志');
            }
          }
        });
      }).catch(e => console.error('refresh error:', e));
    }

    setInterval(refreshData, 15000);

    function toggleDetail(id) {
      const row = document.getElementById(id);
      const machineRow = row.previousElementSibling;
      if (row.style.display === 'none') {
        row.style.display = 'table-row';
        machineRow.classList.add('expanded');
      } else {
        row.style.display = 'none';
        machineRow.classList.remove('expanded');
      }
    }

    function switchDetailTab(idx, tab, el) {
      const panel = el.parentElement.parentElement;
      const body = panel.querySelector('.detail-body');
      // Lock the current height so the panel doesn't jump
      const curH = body.offsetHeight;
      body.style.minHeight = curH + 'px';
      panel.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
      panel.querySelectorAll('.detail-content').forEach(c => c.classList.remove('active'));
      el.classList.add('active');
      const target = document.getElementById('detail-' + idx + '-' + tab);
      target.classList.add('active');
      // After render, update min-height to the larger of old and new
      requestAnimationFrame(() => {
        const newH = body.scrollHeight;
        body.style.minHeight = Math.max(curH, newH) + 'px';
      });
    }

    function showResult(title, body, isError) {
      const panel = document.getElementById('resultPanel');
      document.getElementById('resultTitle').textContent = title;
      const bodyEl = document.getElementById('resultBody');
      bodyEl.textContent = body;
      bodyEl.className = 'result-body' + (isError ? ' error' : '');
      panel.classList.add('visible');
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function closeResult() { document.getElementById('resultPanel').classList.remove('visible'); }
    function showToast(msg) { const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',3000); }

    function sendCommand(agent, cmd) {
      if (cmd === 'restart' && !confirm('确认重启 ' + agent + ' 的 Gateway？')) return;
      if (cmd === 'stop' && !confirm('确认停止 ' + agent + ' 的 Gateway？')) return;
      cmdRunning = true;
      const cmdLabel = {restart:'重启',status:'状态查询',logs:'日志',doctor:'诊断',stop:'停止',start:'启动',update:'更新','update-restart':'更新+重启',cron:'Cron列表'};
      showResult(agent + ' - ' + (cmdLabel[cmd]||cmd) + ' 执行中...', '正在执行...', false);
      fetch('/api/command', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({agent,command:cmd}) })
      .then(r=>r.json()).then(d=>{ cmdRunning=false; showResult(agent+' - '+(cmdLabel[cmd]||cmd), d.message||'完成', !d.success); })
      .catch(e=>{ cmdRunning=false; showResult(agent+' - '+(cmdLabel[cmd]||cmd), '请求失败: '+e.message, true); });
    }

    function checkLatestVersion(silent) {
      if (!silent) { showResult('版本检查', '正在查询 npm registry...', false); cmdRunning = true; }
      fetch('/api/check-update').then(r=>r.json()).then(d=>{
        cmdRunning=false;
        if(d.error){ if(!silent) showResult('版本检查','查询失败: '+d.error,true); return; }
        const banner=document.getElementById('updateBanner');
        if(d.needsUpdate){
          if(banner){ banner.innerHTML='发现新版本 <strong>'+d.latest+'</strong> (当前: '+d.currentVersions.join(', ')+') <button class="btn-action btn-ok" onclick="fleetUpdate(true)" style="margin-left:8px">立即更新</button>'; banner.style.display='block'; }
          if(!silent) showResult('发现新版本','当前: '+d.currentVersions.join(', ')+'\\nnpm 最新: '+d.latest,false);
        } else {
          if(banner) banner.style.display='none';
          if(!silent) showResult('版本检查','已是最新 ('+d.latest+')',false);
        }
      }).catch(e=>{ cmdRunning=false; if(!silent) showResult('版本检查','失败: '+e.message,true); });
    }

    function fleetUpdate(restart) {
      if (!confirm('更新所有节点的 OpenClaw 并重启 Gateway？')) return;
      cmdRunning=true; showResult('全舰队更新','正在更新所有在线节点...',false);
      fetch('/api/fleet-update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({restart})})
      .then(r=>r.json()).then(d=>{ cmdRunning=false; showResult('全舰队更新结果',d.message||'完成',!d.success); })
      .catch(e=>{ cmdRunning=false; showResult('全舰队更新','失败: '+e.message,true); });
    }

    function saveConfigFile(agent, fileId, btnEl) {
      // 找到对应的 textarea
      const textareas = document.querySelectorAll('.config-editor[data-file-id="' + fileId + '"]');
      let textarea = null;
      for (const ta of textareas) { if (ta.closest('.detail-row')) { textarea = ta; break; } }
      if (!textarea) { showToast('找不到编辑器'); return; }
      const content = textarea.value;
      btnEl.textContent = '保存中...'; btnEl.disabled = true;
      cmdRunning = true;
      fetch('/api/save-config', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ agent, fileId, content })
      })
      .then(r => r.json())
      .then(d => {
        cmdRunning = false; btnEl.disabled = false; btnEl.textContent = '保存';
        if (d.success) {
          showToast('已保存: ' + fileId);
          textarea.classList.add('save-ok');
          setTimeout(() => textarea.classList.remove('save-ok'), 1200);
        } else {
          showResult('保存失败', d.message || '未知错误', true);
        }
      })
      .catch(e => { cmdRunning = false; btnEl.disabled = false; btnEl.textContent = '保存'; showResult('保存失败', e.message, true); });
    }

    setTimeout(() => checkLatestVersion(true), 2000);

    // ── 守护犬告警轮询 ──
    function pollWatchdog() {
      fetch('/api/watchdog-alerts').then(r=>r.json()).then(data => {
        const banner = document.getElementById('watchdogBanner');
        // 显示最新一条告警
        const alerts = data.alerts || [];
        if (alerts.length > 0) {
          const latest = alerts[0];
          const level = latest.level || 'warning';
          const icon = level === 'error' ? '🔴' : '🟡';
          const ago = getTimeAgo(latest.timestamp);
          banner.className = 'watchdog-banner level-' + level;
          banner.innerHTML = icon + ' ' + latest.message + ' <span class="meta">(' + ago + ')</span><button class="dismiss" onclick="this.parentElement.style.display=\\'none\\'">&times;</button>';
          banner.style.display = 'flex';
        }
        // 更新24h报告
        renderWatchdogReport(data);
      }).catch(e => {});
    }

    function getTimeAgo(ts) {
      const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
      if (diff < 60) return diff + '秒前';
      if (diff < 3600) return Math.floor(diff/60) + '分钟前';
      if (diff < 86400) return Math.floor(diff/3600) + '小时前';
      return Math.floor(diff/86400) + '天前';
    }

    function renderWatchdogReport(data) {
      const container = document.getElementById('watchdogReportBody');
      if (!container) return;
      const alerts = data.alerts || [];
      const report = data.report;
      if (alerts.length === 0 && !report) {
        container.innerHTML = '<div class="meta" style="padding:8px 0">守护犬暂无报告</div>';
        return;
      }
      let html = '';
      // 最新巡检摘要
      if (report && report.summary) {
        const s = report.summary;
        html += '<div style="padding:8px 0;font-size:13px;font-weight:600">最新巡检 <span class="meta">' + getTimeAgo(report.timestamp) + '</span></div>';
        html += '<div style="padding:4px 0;font-size:13px">';
        html += '🟢 在线 ' + s.online + ' · ';
        if (s.restarted > 0) html += '🟡 重启 ' + s.restarted + ' · ';
        if (s.offline > 0) html += '🔴 离线 ' + s.offline + ' · ';
        if (s.failed > 0) html += '⚪ 异常 ' + s.failed + ' · ';
        html += '共 ' + s.total + ' 台</div>';
        // 各机器状态
        if (report.machines) {
          html += '<div class="report-timeline" style="margin-top:6px">';
          report.machines.forEach(m => {
            const icon = m.status==='ok'?'🟢':m.status==='self'?'🔵':m.status==='restarted'?'🟡':m.status==='offline'?'🔴':'⚪';
            html += '<div class="entry"><span class="entry-icon">'+icon+'</span><span class="entry-msg">'+(m.label||m.agent)+': '+m.msg+'</span></div>';
          });
          html += '</div>';
        }
      }
      // 告警历史
      if (alerts.length > 0) {
        html += '<div style="padding:10px 0 4px;font-size:13px;font-weight:600">最近告警</div>';
        html += '<div class="report-timeline">';
        alerts.forEach(a => {
          const icon = a.level === 'error' ? '🔴' : '🟡';
          const time = new Date(a.timestamp).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'});
          html += '<div class="entry"><span class="entry-time">'+time+'</span><span class="entry-icon">'+icon+'</span><span class="entry-msg">'+a.message+'</span></div>';
        });
        html += '</div>';
      }
      container.innerHTML = html;
    }

    function toggleWatchdogReport() {
      const body = document.getElementById('watchdogReportBody');
      const arrow = document.getElementById('watchdogArrow');
      if (body.classList.contains('open')) {
        body.classList.remove('open');
        arrow.classList.remove('open');
      } else {
        body.classList.add('open');
        arrow.classList.add('open');
      }
    }

    // 每30秒拉一次守护犬报告
    pollWatchdog();
    setInterval(pollWatchdog, 30000);
  </script>
</body>
</html>`;
}

// ── 读取 fleet-config 的机器信息 ──
function loadFleetConfig() {
  try {
    let raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch (e) { return null; }
}

// ── 查找 agent 对应的机器 Tailscale 信息 ──
function findMachineForAgent(agentId) {
  // 优先从 fleet-config.json 的 machines 里查找
  const config = loadFleetConfig();
  if (config && config.machines) {
    // 直接匹配: agent id == machine key
    if (config.machines[agentId]) return config.machines[agentId];
    // 模糊匹配: 在 agents 列表里找到对应 machine, 再查 machines
    if (config.agents) {
      const agentDef = config.agents.find(a => a.id === agentId);
      if (agentDef && agentDef.machine && config.machines[agentDef.machine]) {
        return config.machines[agentDef.machine];
      }
    }
  }

  // 回退: 从心跳数据里读取 tailscale_ip
  const agents = getAllStatus();
  const agent = agents.find(a => (a.agent_id || a.id) === agentId);
  if (agent && agent.system && agent.system.tailscale_ip) {
    return {
      tailscale_ip: agent.system.tailscale_ip,
      ssh_user: agent.system.platform === 'win32' ? agent.system.hostname : 'root',
      platform: agent.system.platform,
      openclaw_cmd: 'openclaw'
    };
  }

  return null;
}

// ── 构建远程 SSH 命令 ──
function buildRemoteCmd(machine, command) {
  const ip = machine.tailscale_ip;
  const user = machine.ssh_user || 'root';
  const isWin = machine.platform === 'win32';
  const oc = machine.openclaw_cmd || 'openclaw';

  // 针对不同命令构建远程执行的 shell 命令
  let remoteCmd;
  switch (command) {
    case 'restart':
      remoteCmd = isWin
        ? `${oc} gateway stop & start /B ${oc} gateway >nul 2>&1 & echo Gateway restarted`
        : `${oc} gateway stop ; nohup ${oc} gateway >/dev/null 2>&1 & echo Gateway restarted`;
      break;
    case 'stop':
      remoteCmd = `${oc} gateway stop`;
      break;
    case 'start':
      remoteCmd = isWin
        ? `start /B ${oc} gateway >nul 2>&1 & echo Gateway started`
        : `nohup ${oc} gateway >/dev/null 2>&1 & echo Gateway started`;
      break;
    case 'status':
      remoteCmd = `${oc} status --deep`;
      break;
    case 'doctor':
      remoteCmd = `${oc} doctor`;
      break;
    case 'version':
      remoteCmd = `${oc} --version`;
      break;
    case 'logs':
      remoteCmd = `${oc} logs`;
      break;
    default:
      return null;
  }

  // Tailscale SSH 命令
  // Windows 上 tailscale ssh 用 user@ip 格式
  return `tailscale ssh ${user}@${ip} "${remoteCmd}"`;
}

// ── 判断是否是本机 ──
function isLocalMachine(machine) {
  const os = require('os');
  const localHostname = os.hostname();
  // 如果 hostname 匹配，或者 tailscale_ip 是本机的
  if (machine.hostname && machine.hostname.toLowerCase() === localHostname.toLowerCase()) return true;
  // 检查本机网络接口是否包含该 tailscale IP
  try {
    const nets = os.networkInterfaces();
    for (const ifaces of Object.values(nets)) {
      for (const iface of ifaces) {
        if (iface.address === machine.tailscale_ip) return true;
      }
    }
  } catch (e) {}
  return false;
}

// ── 执行命令 (自动判断本地/远程) ──
function executeRemoteCommand(agentId, command, callback) {
  // 优先使用心跳 HTTP 端口（每台机器的 heartbeat 自带命令服务）
  const agents = getAllStatus();
  const agent = agents.find(a => (a.agent_id || a.id) === agentId);
  const cmdPort = agent?.cmd_port || 18790;
  // 优先用 Tailscale IP（跨网段可达），local_ip 仅作兜底
  const machine = findMachineForAgent(agentId) || {};
  const targetIp = agent?.system?.tailscale_ip
    || machine.tailscale_ip
    || agent?.local_ip;

  const local = isLocalMachine(machine);

  if (!local && !targetIp) {
    return callback(null, `找不到 ${agentId} 的网络地址。心跳可能还未上报 IP。`);
  }

  const host = local ? '127.0.0.1' : targetIp;
  const url = `http://${host}:${cmdPort}/api/command`;
  const mode = local ? '本地' : host;
  console.log(`[${new Date().toISOString()}] [${mode}] ${agentId}: ${command} -> ${url}`);

  const postData = JSON.stringify({ command });
  const http = require('http');
  const req = http.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
    timeout: 30000
  }, (resp) => {
    let data = '';
    resp.on('data', c => data += c);
    resp.on('end', () => {
      try {
        const result = JSON.parse(data);
        callback(null, `[${mode}] ${agentId} ${command}:\n${result.message || '完成'}`);
      } catch (e) {
        callback(null, `[${mode}] ${agentId} ${command}:\n${data.slice(0, 500) || '完成'}`);
      }
    });
  });
  req.on('error', (e) => {
    console.log(`[${new Date().toISOString()}] HTTP 命令失败，回退本地执行: ${e.message}`);
    // 回退：本机直接 exec（兼容旧模式）
    if (local) {
      executeLocalCommand(agentId, command, callback);
    } else {
      callback(null, `[${mode}] ${agentId} 连接失败: ${e.message}\n（心跳可能需要重启以启用命令端口）`);
    }
  });
  req.on('timeout', () => { req.destroy(); callback(null, `[${mode}] ${agentId} 请求超时`); });
  req.write(postData);
  req.end();
}

// 本地直接执行命令（回退用）
function executeLocalCommand(agentId, command, callback) {
  const oc = 'openclaw';
  const isWin = os.platform() === 'win32';
  let cmd;
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
    case 'update':  cmd = `npm install -g openclaw@latest && ${oc} --version`; break;
    case 'update-restart': cmd = isWin
      ? `npm install -g openclaw@latest & ${oc} gateway stop & start /B ${oc} gateway >nul 2>&1 & ${oc} --version`
      : `npm install -g openclaw@latest ; ${oc} gateway stop ; nohup ${oc} gateway >/dev/null 2>&1 & ${oc} --version`;
      break;
    default: return callback(null, `不支持: ${command}`);
  }
  exec(cmd, { timeout: 30000, encoding: 'utf8' }, (err, stdout, stderr) => {
    const output = (stdout || '').trim();
    const errMsg = (stderr || err?.message || '').trim();
    callback(null, `[本地] ${agentId} ${command}:\n${output || errMsg || '完成'}`);
  });
}

// ── 检查 npm 上最新 OpenClaw 版本 ──
function checkNpmLatest(callback) {
  const https = require('https');
  const req = https.get('https://registry.npmjs.org/openclaw/latest', { timeout: 10000 }, (resp) => {
    let data = '';
    resp.on('data', c => data += c);
    resp.on('end', () => {
      try {
        const pkg = JSON.parse(data);
        callback(null, pkg.version);
      } catch (e) { callback('JSON 解析失败'); }
    });
  });
  req.on('error', e => callback(e.message));
  req.on('timeout', () => { req.destroy(); callback('请求超时'); });
}

// ── HTTP Server ──
const server = http.createServer((req, res) => {
  // 版本检查 API
  if (req.url === '/api/check-update' && req.method === 'GET') {
    checkNpmLatest((err, latest) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err }));
      }
      const agents = getAllStatus().filter(a => !a.never_seen && a.openclaw_version);
      const currentVersions = [...new Set(agents.map(a => {
        // "OpenClaw 2026.3.12 (6472949)" → "2026.3.12"
        const m = (a.openclaw_version || '').match(/(\d+\.\d+\.\d+)/);
        return m ? m[1] : 'unknown';
      }))];
      const needsUpdate = currentVersions.some(v => v !== latest && v !== 'unknown');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ latest, currentVersions, needsUpdate }));
    });
    return;
  }
  if (req.url === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(getAllStatus()));
  }
  // AJAX 局部刷新数据
  if (req.url === '/api/dashboard-data' && req.method === 'GET') {
    const agents = getAllStatus();
    const onlineCount = agents.filter(a => a.online && a.gateway_alive && a.telegram_reachable !== false).length;
    const tgBlockedCount = agents.filter(a => a.online && a.gateway_alive && a.telegram_reachable === false).length;
    const gwStoppedCount = agents.filter(a => a.online && !a.gateway_alive).length;
    const offlineCount = agents.filter(a => !a.online && !a.never_seen).length;
    const total = agents.length;
    let totalTokensToday=0,totalCostToday=0,totalSessions=0,totalCronJobs=0,totalTokens30d=0,totalCost30d=0;
    agents.forEach(a => {
      const oc = a.openclaw || {};
      const tu = oc.token_usage || {};
      if (tu.today) { totalTokensToday += tu.today.total||0; totalCostToday += tu.today.cost||0; }
      if (tu.days30) { totalTokens30d += tu.days30.total||0; totalCost30d += tu.days30.cost||0; }
      totalSessions += oc.sessions?.total || 0;
      totalCronJobs += Array.isArray(oc.cron_jobs) ? oc.cron_jobs.length : 0;
    });
    function fmtT(n) { return n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(n); }
    function fmtC(n) { return n>0?'$'+n.toFixed(3):'$0'; }
    const machinesData = agents.map(a => {
      const isNever = a.never_seen;
      const isOk = a.online && a.gateway_alive;
      const tgBlocked = isOk && a.telegram_reachable === false;
      const gwStatus = isNever?'disabled':(!a.online?'over':(!a.gateway_alive?'warn':(tgBlocked?'warn':'ok')));
      const gwLabel = isNever?'待部署':(!a.online?'离线':(!a.gateway_alive?'GW停止':(tgBlocked?'TG断连':'运行中')));
      const memPct = a.system?.memory?.usage_percent||0;
      const memTotal = a.system?.memory?.total?Math.round(a.system.memory.total/1024)+'G':'-';
      const memStatus = memPct>85?'over':memPct>70?'warn':'ok';
      const agentId = a.agent_id||a.id;
      const oc = a.openclaw||{};
      const tu = oc.token_usage||{};
      return {
        agentId, isNever, isOk, online: a.online, tgBlocked,
        gwStatus, gwLabel, memPct, memTotal, memStatus,
        cpu: isNever?'-':(a.system?.cpu_count||'?')+'核',
        uptime: a.system?.uptime||0,
        todayTokens: tu.today?.total||0,
        elapsed: a.elapsedText,
        hbVersion: a.heartbeat_version||0,
        latestVersion: LATEST_HEARTBEAT_VERSION,
        botSynced: a.bot_config?.synced||false,
        botExpected: a.bot_config?.expected||false
      };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      now: new Date().toLocaleString('zh-CN'),
      overview: { onlineCount, total, totalSessions, totalCronJobs, totalTokensToday: fmtT(totalTokensToday), totalCostToday: fmtC(totalCostToday), totalTokens30d: fmtT(totalTokens30d), totalCost30d: fmtC(totalCost30d), abnormal: offlineCount+gwStoppedCount+tgBlockedCount },
      machines: machinesData
    }));
  }
  if (req.url === '/api/command' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { agent, command } = JSON.parse(body);
        executeRemoteCommand(agent, command, (err, result) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (err) {
            res.end(JSON.stringify({ success: false, message: err }));
          } else {
            res.end(JSON.stringify({ success: true, message: result }));
          }
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  // 全舰队批量更新 API
  if (req.url === '/api/fleet-update' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { restart } = JSON.parse(body);
        const agents = getAllStatus().filter(a => !a.never_seen);
        if (agents.length === 0) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: '没有在线节点可更新' }));
        }
        const command = restart ? 'update-restart' : 'update';
        const results = [];
        let done = 0;
        agents.forEach(a => {
          const id = a.agent_id || a.id;
          executeRemoteCommand(id, command, (err, result) => {
            results.push({ agent: id, result: err || result });
            done++;
            if (done === agents.length) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, message: results.map(r => r.result).join('\n\n') }));
            }
          });
        });
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  // 保存配置文件 API
  if (req.url === '/api/save-config' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { agent, fileId, content } = JSON.parse(body);
        if (!fileId || content === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: '缺少 fileId 或 content' }));
        }
        // 从 fleet-status.json 找到该 agent 的 soul_file / memory_file
        const agents = getAllStatus();
        const targetAgent = agents.find(a => (a.agent_id || a.id) === agent);
        if (!targetAgent) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: '找不到 agent: ' + agent }));
        }
        const oc = targetAgent.openclaw || {};
        let targetFile = null;
        if (fileId === 'soul') targetFile = oc.soul_file;
        else if (fileId === 'memory') targetFile = oc.memory_file;
        if (!targetFile || !targetFile.path) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, message: '找不到文件: ' + fileId }));
        }
        // 写入文件（先备份）
        const filePath = targetFile.path;
        const fs = require('fs');
        if (fs.existsSync(filePath)) {
          fs.copyFileSync(filePath, filePath + '.bak');
        }
        fs.writeFileSync(filePath, content, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '已保存: ' + targetFile.label }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: e.message }));
      }
    });
    return;
  }
  // ── 守护犬告警接收 ──
  if (req.url === '/api/watchdog-alert' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const alert = JSON.parse(body);
        // 存储告警（最多保留100条）
        if (!global.watchdogAlerts) global.watchdogAlerts = [];
        global.watchdogAlerts.unshift(alert);
        if (global.watchdogAlerts.length > 100) global.watchdogAlerts.length = 100;
        // 保存最新巡检报告
        if (alert.type === 'report') global.watchdogReport = alert;
        // 持久化到文件
        try {
          const alertsFile = path.join(statusDir, 'heartbeats', '_watchdog-alerts.json');
          fs.writeFileSync(alertsFile, JSON.stringify({
            alerts: global.watchdogAlerts.filter(a => a.type === 'alert').slice(0, 50),
            report: global.watchdogReport
          }, null, 2));
        } catch (e) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (req.url === '/api/watchdog-alerts' && req.method === 'GET') {
    // 如果内存没数据，尝试从文件加载
    if (!global.watchdogAlerts) {
      try {
        const alertsFile = path.join(statusDir, 'heartbeats', '_watchdog-alerts.json');
        if (fs.existsSync(alertsFile)) {
          const saved = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
          global.watchdogAlerts = saved.alerts || [];
          global.watchdogReport = saved.report || null;
        }
      } catch (e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      alerts: (global.watchdogAlerts || []).filter(a => a.type === 'alert').slice(0, 20),
      report: global.watchdogReport || null
    }));
    return;
  }
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderDashboard());
  }
  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🦞 小龙虾舰队控制面板 v3`);
  console.log(`   访问: http://0.0.0.0:${PORT}`);
  console.log(`   状态文件: ${STATUS_FILE}\n`);
});
