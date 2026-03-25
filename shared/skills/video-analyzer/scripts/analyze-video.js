#!/usr/bin/env node
/**
 * Video Extractor — 提取在线视频的元信息、直链 URL 和字幕
 *
 * 用法:
 *   node analyze-video.js <VIDEO_URL>
 *
 * 输出 JSON 包含：title, duration, description, direct_url, subtitles
 * 供 OpenClaw agent 配合多模态模型（如 Mimo-V2-Omni）使用
 *
 * 依赖:
 *   yt-dlp (系统命令)
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── PATH fix (Windows pip installs yt-dlp to user Scripts) ──────────────────

if (process.platform === 'win32') {
  // Python user Scripts (yt-dlp, whisper)
  const userScripts = path.join(os.homedir(), 'AppData', 'Roaming', 'Python');
  try {
    const pyDirs = fs.readdirSync(userScripts).filter(d => d.startsWith('Python'));
    for (const d of pyDirs) {
      const scriptsDir = path.join(userScripts, d, 'Scripts');
      if (fs.existsSync(scriptsDir) && !process.env.PATH.includes(scriptsDir)) {
        process.env.PATH = `${process.env.PATH};${scriptsDir}`;
      }
    }
  } catch { /* ignore */ }
  // ffmpeg installed via winget
  const wingetPkgs = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  try {
    const ffmpegDirs = fs.readdirSync(wingetPkgs).filter(d => d.startsWith('Gyan.FFmpeg'));
    for (const d of ffmpegDirs) {
      const subDirs = fs.readdirSync(path.join(wingetPkgs, d));
      for (const sd of subDirs) {
        const binDir = path.join(wingetPkgs, d, sd, 'bin');
        if (fs.existsSync(path.join(binDir, 'ffmpeg.exe')) && !process.env.PATH.includes(binDir)) {
          process.env.PATH = `${process.env.PATH};${binDir}`;
        }
      }
    }
  } catch { /* ignore */ }
} else {
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', `${os.homedir()}/.local/bin`];
  for (const p of extraPaths) {
    if (fs.existsSync(p) && !process.env.PATH.includes(p)) {
      process.env.PATH = `${process.env.PATH}:${p}`;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) {
  process.stderr.write(`[video-extractor] ${msg}\n`);
}

function formatDuration(seconds) {
  if (!seconds) return 'unknown';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}分${s}秒`;
}

function getVideoInfo(url) {
  log('Fetching video metadata...');
  const result = spawnSync('yt-dlp', [
    '--dump-json', '--no-warnings', '--no-playlist', url
  ], { encoding: 'utf-8', timeout: 30000 });

  if (result.status !== 0) {
    throw new Error(`yt-dlp metadata failed: ${result.stderr || 'unknown error'}`);
  }
  return JSON.parse(result.stdout);
}

function getDirectVideoUrl(url) {
  log('Extracting direct video URL...');
  const result = spawnSync('yt-dlp', [
    '-g', '-f', 'worstvideo+worstaudio/worst/best',
    '--no-warnings', '--no-playlist', url
  ], { encoding: 'utf-8', timeout: 60000 });

  if (result.status !== 0) {
    throw new Error(`yt-dlp URL extraction failed: ${result.stderr || 'unknown error'}`);
  }
  return result.stdout.trim().split('\n')[0];
}

function getSubtitles(url) {
  log('Extracting subtitles...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-extractor-'));
  const outTemplate = path.join(tmpDir, 'subs');

  spawnSync('yt-dlp', [
    '--write-sub', '--write-auto-sub',
    '--sub-lang', 'zh,zh-CN,zh-Hans,en',
    '--sub-format', 'srt/vtt/best',
    '--skip-download', '--no-warnings', '--no-playlist',
    '-o', outTemplate, url
  ], { encoding: 'utf-8', timeout: 30000 });

  let subtitleText = '';
  try {
    const files = fs.readdirSync(tmpDir).filter(f => /\.(srt|vtt|ass)$/i.test(f));
    if (files.length > 0) {
      const zhFile = files.find(f => /zh|cn|hans/i.test(f)) || files[0];
      const raw = fs.readFileSync(path.join(tmpDir, zhFile), 'utf-8');
      subtitleText = cleanSubtitles(raw);
      log(`Found subtitles: ${zhFile} (${subtitleText.length} chars)`);
    }
  } catch { /* ignore */ }

  try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  return subtitleText;
}

/**
 * Whisper 语音转文字（当没有字幕时 fallback）
 */
function whisperTranscribe(url) {
  log('No subtitles found. Downloading audio for Whisper transcription...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-whisper-'));
  const audioFile = path.join(tmpDir, 'audio.mp3');

  // Download audio only
  const dlResult = spawnSync('yt-dlp', [
    '-x', '--audio-format', 'mp3',
    '--audio-quality', '5',  // lower quality = smaller file = faster
    '--no-warnings', '--no-playlist',
    '-o', audioFile,
    url
  ], { encoding: 'utf-8', timeout: 120000 });

  if (dlResult.status !== 0) {
    throw new Error(`Audio download failed: ${dlResult.stderr || 'unknown error'}`);
  }

  // Find the actual output file (yt-dlp may add extension)
  let actualFile = audioFile;
  if (!fs.existsSync(audioFile)) {
    const files = fs.readdirSync(tmpDir).filter(f => /\.(mp3|m4a|wav|ogg)$/i.test(f));
    if (files.length > 0) actualFile = path.join(tmpDir, files[0]);
    else throw new Error('Audio file not found after download');
  }

  log(`Audio downloaded (${(fs.statSync(actualFile).size / 1024 / 1024).toFixed(1)} MB). Running Whisper...`);

  // Run Whisper via Python — output to file to avoid Windows encoding issues
  const transcriptFile = path.join(tmpDir, 'transcript.txt');
  const whisperScript = `
import os, whisper, sys
${process.platform === 'win32' ? `
# Add ffmpeg to PATH on Windows (winget install location)
import glob
ffmpeg_dirs = glob.glob(os.path.expanduser("~/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg*/*/bin"))
for d in ffmpeg_dirs:
    if os.path.exists(os.path.join(d, "ffmpeg.exe")):
        os.environ["PATH"] = os.environ["PATH"] + ";" + d
        break
` : ''}
model = whisper.load_model("base")
result = model.transcribe(sys.argv[1], language="zh", fp16=False)
with open(sys.argv[2], "w", encoding="utf-8") as f:
    f.write(result["text"])
print(len(result["text"]))
`.trim();

  const whisperResult = spawnSync('python', ['-c', whisperScript, actualFile, transcriptFile], {
    encoding: 'utf-8',
    timeout: 600000  // 10 min timeout for CPU transcription
  });

  if (whisperResult.status !== 0) {
    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    throw new Error(`Whisper failed: ${whisperResult.stderr || 'unknown error'}`);
  }

  // Read transcript from file (proper UTF-8)
  const transcript = fs.readFileSync(transcriptFile, 'utf-8');
  log(`Whisper transcription complete (${transcript.length} chars)`);

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  return transcript;
}

function cleanSubtitles(raw) {
  return raw
    .replace(/WEBVTT[\s\S]*?\n\n/, '')
    .replace(/^\d+\s*$/gm, '')
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * 生成 Markdown 格式的笔记（可发布到 Mytimelinediary）
 */
function generateMarkdown(result) {
  const date = new Date().toISOString().split('T')[0];
  const text = result.transcript || result.subtitles || '';

  let md = `# ${result.title || 'Video Note'}\n\n`;
  md += `> **来源:** [${result.platform}](${result.url})  \n`;
  md += `> **UP主:** ${result.uploader || 'unknown'}  \n`;
  md += `> **时长:** ${result.duration_formatted || 'unknown'}  \n`;
  md += `> **提取日期:** ${date}  \n`;
  md += `> **提取方式:** ${result.transcript_source === 'whisper' ? 'Whisper 语音转录' : '字幕提取'}\n\n`;

  if (result.description) {
    md += `## 简介\n\n${result.description}\n\n`;
  }

  md += `## 完整转录\n\n${text || '（无内容）'}\n`;

  return md;
}

function main() {
  const args = process.argv.slice(2);
  const mdFlag = args.includes('--md');
  const saveFlag = args.find(a => a.startsWith('--save='));
  const videoUrl = args.find(a => !a.startsWith('--'));

  if (!videoUrl) {
    console.error('Usage: node analyze-video.js <VIDEO_URL> [--md] [--save=<path>]');
    console.error('  --md       Output as Markdown instead of JSON');
    console.error('  --save=DIR Save .md file to directory');
    process.exit(1);
  }

  // Check yt-dlp
  try {
    execSync('yt-dlp --version', { stdio: 'pipe' });
  } catch {
    console.error('yt-dlp is not installed.\n  Install: pip install yt-dlp  OR  brew install yt-dlp');
    process.exit(1);
  }

  const result = {
    url: videoUrl,
    platform: videoUrl.includes('bilibili') ? 'Bilibili' : videoUrl.includes('youtube') || videoUrl.includes('youtu.be') ? 'YouTube' : 'Other',
    title: null,
    duration: null,
    duration_formatted: null,
    uploader: null,
    description: null,
    direct_video_url: null,
    subtitles: null
  };

  // Step 1: Metadata
  try {
    const info = getVideoInfo(videoUrl);
    result.title = info.title;
    result.duration = info.duration;
    result.duration_formatted = formatDuration(info.duration);
    result.uploader = info.uploader || info.channel || null;
    result.description = info.description || null;
    log(`Video: "${info.title}" (${formatDuration(info.duration)})`);
  } catch (e) {
    log(`Warning: metadata failed: ${e.message}`);
  }

  // Step 2: Direct URL
  try {
    result.direct_video_url = getDirectVideoUrl(videoUrl);
    log('Direct URL obtained.');
  } catch (e) {
    log(`Warning: direct URL failed: ${e.message}`);
  }

  // Step 3: Subtitles
  try {
    const subs = getSubtitles(videoUrl);
    if (subs) result.subtitles = subs;
  } catch (e) {
    log(`Warning: subtitles failed: ${e.message}`);
  }

  // Step 4: Whisper fallback (if no subtitles)
  if (!result.subtitles) {
    try {
      result.transcript = whisperTranscribe(videoUrl);
      result.transcript_source = 'whisper';
    } catch (e) {
      log(`Warning: Whisper transcription failed: ${e.message}`);
    }
  } else {
    result.transcript_source = 'subtitles';
  }

  // Step 5: Output
  if (mdFlag || saveFlag) {
    const md = generateMarkdown(result);

    if (saveFlag) {
      const saveDir = saveFlag.split('=')[1];
      const safeTitle = (result.title || 'video-note').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
      const date = new Date().toISOString().split('T')[0];
      const filePath = path.join(saveDir, `${date}-${safeTitle}.md`);
      fs.mkdirSync(saveDir, { recursive: true });
      fs.writeFileSync(filePath, md, 'utf-8');
      log(`Saved to: ${filePath}`);
    }

    console.log(md);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main();
