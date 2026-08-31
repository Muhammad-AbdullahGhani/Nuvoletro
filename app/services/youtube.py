import logging
import re
from pathlib import Path

import yt_dlp

logger = logging.getLogger(__name__)

YOUTUBE_URL_RE = re.compile(
    r"(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/|m\.youtube\.com/watch\?v=)[\w-]+",
    re.I,
)


def is_youtube_url(url: str) -> bool:
    return bool(url and YOUTUBE_URL_RE.search(url.strip()))


def download_youtube_audio(url: str, job_id: str, dest_dir: Path) -> tuple[Path, str]:
    """Extract audio from a YouTube video via yt-dlp with client fallbacks."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    out_template = str(dest_dir / f"{job_id}.%(ext)s")

    logger.info(f"Downloading YouTube audio: {url[:100]}...")

    ydl_opts = {
        "format": "bestaudio/best",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "128",
            }
        ],
        "outtmpl": out_template,
        "noplaylist": True,
        "restrictfilenames": True,
        "extractor_args": {
            "youtube": {
                "player_client": ["android", "ios", "web", "mweb"]
            }
        },
        "quiet": True,
        "no_warnings": False,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url.strip(), download=True)
            title = (info or {}).get("title") or job_id
    except Exception as exc:
        logger.error(f"yt-dlp extraction failed: {str(exc)}", exc_info=True)
        raise RuntimeError(f"YouTube audio extraction failed: {str(exc)[:250]}") from exc

    matches = sorted(dest_dir.glob(f"{job_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not matches:
        raise RuntimeError("yt-dlp completed but no audio file was produced")

    media = matches[0]
    file_size_mb = media.stat().st_size / 1024 / 1024
    logger.info(f"YouTube audio downloaded: {media.name} ({file_size_mb:.2f} MB)")
    return media, str(title)
