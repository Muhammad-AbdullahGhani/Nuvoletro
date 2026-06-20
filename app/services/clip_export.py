import shutil
import subprocess
from pathlib import Path

from app.config import ROOT
from app.models import ClipSuggestion

EXPORTS_DIR = ROOT / "data" / "exports" / "clips"


class ClipExportError(RuntimeError):
    pass


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def export_clip(
    source_media: str | None,
    clip: ClipSuggestion,
    job_id: str,
    index: int,
    vertical: bool = True,
) -> Path:
    if not source_media:
        raise ClipExportError(
            "No source video for this job. Clip export needs an uploaded video file "
            "(transcript-only jobs give timestamps but no media to cut)."
        )
    src = Path(source_media)
    if not src.exists():
        raise ClipExportError("Source media file no longer exists on disk.")
    if not ffmpeg_available():
        raise ClipExportError("ffmpeg is not installed or not on PATH. Install it to export clips.")

    EXPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out = EXPORTS_DIR / f"{job_id}_clip{index}.mp4"
    duration = max(1.0, clip.end - clip.start)

    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{clip.start:.2f}",
        "-i",
        str(src),
        "-t",
        f"{duration:.2f}",
    ]

    if vertical:
        cmd += [
            "-vf",
            "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
        ]

    cmd += [
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        str(out),
    ]

    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except subprocess.CalledProcessError as exc:  # pragma: no cover - ffmpeg runtime error
        stderr = exc.stderr.decode("utf-8", "ignore")[-500:] if exc.stderr else ""
        raise ClipExportError(f"ffmpeg failed: {stderr}") from exc

    return out
