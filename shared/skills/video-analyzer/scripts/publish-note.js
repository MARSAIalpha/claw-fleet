#!/usr/bin/env node
/**
 * Publish Note to Mytimelinediary
 *
 * 把 markdown 笔记发布到 Mytimelinediary 的 Supabase 数据库
 * 可作为"系统广播"发给所有用户
 *
 * 用法:
 *   node publish-note.js <markdown_file>
 *   node publish-note.js <markdown_file> --title="自定义标题"
 *   node publish-note.js --stdin --title="标题"   (从 stdin 读取 markdown)
 *
 * 环境变量:
 *   SUPABASE_URL          — Supabase 项目 URL
 *   SUPABASE_SERVICE_KEY  — Supabase service_role key（绕过 RLS）
 *   PUBLISH_USER_ID       — 发布者的 user_id（默认用系统账号）
 *
 * 也可配合 video analyzer 使用:
 *   node analyze-video.js "https://bilibili.com/..." --md | node publish-note.js --stdin --title="视频笔记"
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rtbtpgiickomhjstolwm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
const PUBLISH_USER_ID = process.env.PUBLISH_USER_ID || null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function supabaseRequest(method, tablePath, body) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_KEY) {
      reject(new Error('SUPABASE_SERVICE_KEY or SUPABASE_KEY not set'));
      return;
    }

    const url = new URL(SUPABASE_URL + '/rest/v1/' + tablePath);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Prefer': 'return=representation'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`Supabase ${res.statusCode}: ${parsed.message || data}`));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(`Parse error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * 从 markdown 内容提取标题（第一个 # 行）
 */
function extractTitle(md) {
  const match = md.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : 'Video Note';
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const fromStdin = args.includes('--stdin');
  const titleArg = args.find(a => a.startsWith('--title='));
  const filePath = args.find(a => !a.startsWith('--'));

  if (!fromStdin && !filePath) {
    console.error('Usage: node publish-note.js <markdown_file> [--title="..."]');
    console.error('       node publish-note.js --stdin [--title="..."]');
    process.exit(1);
  }

  if (!SUPABASE_KEY) {
    console.error('Error: Set SUPABASE_SERVICE_KEY environment variable');
    console.error('  Get it from: Supabase Dashboard → Settings → API → service_role key');
    process.exit(1);
  }

  // Read markdown content
  let markdown;
  if (fromStdin) {
    markdown = fs.readFileSync(0, 'utf-8'); // stdin
  } else {
    markdown = fs.readFileSync(filePath, 'utf-8');
  }

  const title = titleArg ? titleArg.split('=').slice(1).join('=') : extractTitle(markdown);
  const now = Date.now();

  // Build entry in Mytimelinediary format
  const entry = {
    id: `broadcast_${now}_${Math.floor(Math.random() * 10000)}`,
    ts: now,
    h: new Date().getHours(),
    title: title,
    content: markdown,
    mood: 'notebook',
    weather: 'sun',
    privacy: 'public',
    is_task: false,
    recurrence: 'none',
    anni: false,
    is_holiday: false
  };

  // Add user_id if configured
  if (PUBLISH_USER_ID) {
    entry.user_id = PUBLISH_USER_ID;
  }

  console.error(`[publish] Title: ${title}`);
  console.error(`[publish] Content: ${markdown.length} chars`);

  try {
    const result = await supabaseRequest('POST', 'entries', entry);
    console.error('[publish] Success!');
    console.log(JSON.stringify({
      success: true,
      id: entry.id,
      title: title,
      url: `${SUPABASE_URL}/rest/v1/entries?id=eq.${entry.id}`
    }, null, 2));
  } catch (e) {
    console.error(`[publish] Failed: ${e.message}`);
    process.exit(1);
  }
}

main();
