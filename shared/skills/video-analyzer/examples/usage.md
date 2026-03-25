# Video Analyzer 使用示例

## 基础用法

```bash
# 分析 B站视频
node shared/skills/video-analyzer/scripts/analyze-video.js "https://www.bilibili.com/video/BV1XFQoBgEuz/"

# 分析 YouTube 视频
node shared/skills/video-analyzer/scripts/analyze-video.js "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# 带自定义分析提示
node shared/skills/video-analyzer/scripts/analyze-video.js "https://www.bilibili.com/video/BV1XFQoBgEuz/" "请提取视频中提到的所有技术栈和工具"
```

## 环境变量

```bash
export OPENROUTER_API_KEY="sk-or-v1-..."
```

## 输出格式

```json
{
  "title": "视频标题",
  "duration": 300,
  "duration_formatted": "5分0秒",
  "platform": "Bilibili",
  "uploader": "UP主名称",
  "description": "视频描述...",
  "had_subtitles": true,
  "had_video_url": true,
  "analysis": "Mimo-V2-Omni 的详细分析内容...",
  "key_points": [
    "要点1",
    "要点2"
  ],
  "tokens_used": {
    "input": 12345,
    "output": 1024,
    "total": 13369
  }
}
```

## 在 Telegram 中使用

用户发送消息：
> 帮我分析一下这个视频 https://www.bilibili.com/video/BV1XFQoBgEuz/

OpenClaw agent 会自动触发 video-analyzer skill 并返回分析结果。

## 安装依赖

```bash
# macOS
brew install yt-dlp

# Windows
pip install yt-dlp

# Linux
pip install yt-dlp
# 或
sudo apt install yt-dlp
```
