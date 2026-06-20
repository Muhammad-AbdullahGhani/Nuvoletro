import logging
import subprocess
from pathlib import Path

from openai import OpenAI

from app.config import settings
from app.models import TranscriptSegment

logger = logging.getLogger(__name__)

DEMO_TRANSCRIPT = """
Welcome back to the channel. Today we are breaking down three SEO mistakes
that kill your reach on YouTube, Instagram, and TikTok.
First mistake: copying the same caption everywhere. Each platform has different search behavior.
Second: weak hooks in the first three seconds. If you lose viewers early, the algorithm won't push you.
Third: no keywords in your title and description. Creators who fix this usually see better discovery within weeks.
Let me show you a simple publish workflow you can repeat every upload.
"""


def extract_audio(video_path: Path) -> Path:
    out = video_path.with_suffix(".mp3")
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-acodec",
        "libmp3lame",
        "-q:a",
        "4",
        str(out),
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return out


def transcribe_file(media_path: Path, language: str | None = None) -> tuple[str, list[TranscriptSegment]]:
    if not settings.has_openai:
        logger.info(f"Using demo transcript (OpenAI key not configured): {media_path.name}")
        return _demo_transcript()

    client = OpenAI(api_key=settings.openai_api_key)
    audio_path = media_path
    if media_path.suffix.lower() in {".mp4", ".mov", ".mkv", ".webm"}:
        logger.info(f"Extracting audio: {media_path.name}")
        audio_path = extract_audio(media_path)

    logger.info(f"Transcribing with Whisper: {audio_path.name} (language: {language or 'auto-detect'})")
    with audio_path.open("rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            language=language,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )

    segments: list[TranscriptSegment] = []
    raw_segments = getattr(response, "segments", None) or []
    for seg in raw_segments:
        segments.append(
            TranscriptSegment(
                start=float(seg.get("start", 0)),
                end=float(seg.get("end", 0)),
                text=(seg.get("text") or "").strip(),
            )
        )

    text = (getattr(response, "text", None) or "").strip()
    if not text and segments:
        text = " ".join(s.text for s in segments)
    
    logger.info(f"Transcription complete: {len(text)} chars, {len(segments)} segments")
    return text, segments


def transcribe_text_paste(text: str) -> tuple[str, list[TranscriptSegment]]:
    cleaned = text.strip()
    if not cleaned:
        return _demo_transcript()
    parts = [p.strip() for p in cleaned.replace("\n", " ").split(". ") if p.strip()]
    segments: list[TranscriptSegment] = []
    t = 0.0
    for part in parts:
        duration = max(3.0, min(12.0, len(part.split()) * 0.35))
        segments.append(TranscriptSegment(start=t, end=t + duration, text=part))
        t += duration
    return cleaned, segments


def _demo_transcript() -> tuple[str, list[TranscriptSegment]]:
    text = DEMO_TRANSCRIPT.strip()
    segments = transcribe_text_paste(text)[1]
    return text, segments
