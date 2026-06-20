# Deploying Nuvoletro

The `Dockerfile` installs **ffmpeg** for audio extraction and clip export. Install **yt-dlp** is included via pip.

## Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `OPENAI_API_KEY` | Live transcription | Whisper API |
| `GEMINI_API_KEY` | Live generation | Gemini post writing |
| `WORKER_COUNT` | Optional | Default `4` parallel workers |
| `PORT` | Set by host | Railway/Render inject automatically |

## Docker

```bash
docker build -t nuvoletro .
docker run -d -p 8080:8080 \
  -e OPENAI_API_KEY=sk-... \
  -e GEMINI_API_KEY=... \
  -e WORKER_COUNT=4 \
  --name nuvoletro nuvoletro
```

Health check: `GET /api/health`
