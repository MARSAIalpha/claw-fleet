---
name: video-analyzer
description: This skill should be used when the user sends a video URL (Bilibili, YouTube, or other platforms), asks to "analyze a video", "summarize this video", "watch this video", "帮我看看这个视频", or mentions keywords like "视频分析", "看看这个视频", "总结视频内容", "发布到笔记本", "广播". Trigger on any bilibili.com or youtube.com link.
version: 2.0.0
---

# 视频知识提取 & 发布

从 B站/YouTube 视频中提取完整内容（语音转文字），生成结构化笔记，可发布到 Mytimelinediary 笔记本。

## 完整工作流

```
用户发视频链接
  ↓
Step 1: 提取视频内容（yt-dlp + Whisper 语音转文字）
  ↓
Step 2: 总结知识要点
  ↓
Step 3: 保存/发布（本地 markdown 或推送到 Mytimelinediary）
```

## Step 1: 提取视频内容

运行提取脚本，自动完成：元信息获取 → 字幕提取 → 无字幕时 Whisper 语音转文字

```bash
# JSON 格式输出（默认）
node shared/skills/video-analyzer/scripts/analyze-video.js "<VIDEO_URL>"

# Markdown 格式输出
node shared/skills/video-analyzer/scripts/analyze-video.js "<VIDEO_URL>" --md

# Markdown 输出并保存到文件
node shared/skills/video-analyzer/scripts/analyze-video.js "<VIDEO_URL>" --md --save=shared/knowledge
```

**输出字段：**
- `title` — 视频标题
- `duration_formatted` — 时长（如 "11分14秒"）
- `uploader` — UP主/频道名
- `description` — 视频描述
- `transcript` — Whisper 转录的完整文字（无字幕时自动启用）
- `subtitles` — 字幕文本（有字幕时）
- `direct_video_url` — 直链 URL

## Step 2: 总结知识要点

拿到转录文本后，用中文总结：

1. **视频基本信息**：标题、时长、UP主
2. **内容概述**：2-3 段话概括视频讲了什么
3. **关键知识点**：bullet points 列出核心要点
4. **提到的技术/工具/产品**（如果有）
5. **可操作的步骤**（如果是教程类视频）

## Step 3: 保存和发布

### 方式 A：保存为本地笔记

```bash
node shared/skills/video-analyzer/scripts/analyze-video.js "<URL>" --md --save=shared/knowledge
```

文件自动保存到 `shared/knowledge/` 目录，通过 Syncthing 同步到所有机器。

### 方式 B：发布到 Mytimelinediary 笔记本

```bash
# 需要设置环境变量
export SUPABASE_SERVICE_KEY="your-service-role-key"

# 提取并直接发布
node shared/skills/video-analyzer/scripts/analyze-video.js "<URL>" --md | \
  node shared/skills/video-analyzer/scripts/publish-note.js --stdin --title="视频笔记标题"

# 或发布已有的 markdown 文件
node shared/skills/video-analyzer/scripts/publish-note.js shared/knowledge/2026-03-25-xxx.md
```

发布后，所有 Mytimelinediary 用户都能在 timeline 上看到这条笔记（像系统公告）。

## 依赖

| 工具 | 安装命令 | 用途 |
|------|---------|------|
| yt-dlp | `pip install yt-dlp` | 提取视频元信息、直链、字幕 |
| ffmpeg | `winget install Gyan.FFmpeg` 或 `brew install ffmpeg` | Whisper 音频处理 |
| whisper | `pip install openai-whisper` | 语音转文字（无字幕时自动启用） |

## 脚本文件

- **`scripts/analyze-video.js`** — 视频提取（yt-dlp + Whisper）
- **`scripts/publish-note.js`** — 发布到 Mytimelinediary（Supabase）
- **`examples/usage.md`** — 使用示例
