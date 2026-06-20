import logging
import re
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

YOUTUBE_URL_RE = re.compile(
    r"(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)[\w-]+",
    re.I,
)


def is_youtube_url(url: str) -> bool:
    return bool(url and YOUTUBE_URL_RE.search(url.strip()))


def download_youtube_audio(url: str, job_id: str, dest_dir: Path) -> tuple[Path, str]:
    """Extract audio from a YouTube video via yt-dlp — no manual steps."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    out_template = str(dest_dir / f"{job_id}.%(ext)s")

    logger.info(f"Downloading YouTube audio: {url[:100]}...")
    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "5",
        "-o",
        out_template,
        "--no-playlist",
        "--restrict-filenames",
        url.strip(),
    ]
    subprocess.run(cmd, check=True, capture_output=True)

    matches = sorted(dest_dir.glob(f"{job_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not matches:
        raise RuntimeError("yt-dlp completed but no audio file was produced")

    media = matches[0]
    file_size_mb = media.stat().st_size / 1024 / 1024
    logger.info(f"YouTube audio downloaded: {media.name} ({file_size_mb:.2f} MB)")
    return media, media.stem
