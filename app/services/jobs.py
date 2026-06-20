import logging
import uuid
from pathlib import Path

from fastapi import UploadFile

from app.config import JOBS_DIR, UPLOAD_DIR, settings
from app.models import JobResult, JobStatus
from app.services.content_pack import build_content_kit
from app.services.transcribe import transcribe_file, transcribe_text_paste
from app.services.youtube import download_youtube_audio, is_youtube_url

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".mp3", ".wav", ".m4a", ".mpeg", ".mpga"}


def _job_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def save_job(job: JobResult) -> None:
    _job_path(job.job_id).write_text(job.model_dump_json(indent=2), encoding="utf-8")


def load_job(job_id: str) -> JobResult | None:
    path = _job_path(job_id)
    if not path.exists():
        return None
    return JobResult.model_validate_json(path.read_text(encoding="utf-8"))


async def submit_job(
    file: UploadFile | None,
    transcript_text: str | None,
    youtube_url: str | None,
    niche: str | None,
    language: str,
) -> JobResult:
    """Create a pending job and enqueue for parallel worker processing."""
    from app.workers.pool import enqueue_job

    job_id = str(uuid.uuid4())
    job = JobResult(
        job_id=job_id,
        status=JobStatus.pending,
        niche=niche,
        language=language,
        youtube_url=youtube_url.strip() if youtube_url else None,
        demo=not settings.is_live,
    )
    save_job(job)

    # Stash upload bytes before async worker runs (UploadFile stream closes after request)
    if file and file.filename:
        ext = Path(file.filename).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            job.status = JobStatus.failed
            job.error = f"Unsupported file type: {ext}"
            save_job(job)
            return job
        dest = UPLOAD_DIR / f"{job_id}{ext}"
        content = await file.read()
        max_bytes = settings.max_upload_mb * 1024 * 1024
        if len(content) > max_bytes:
            job.status = JobStatus.failed
            job.error = f"File exceeds {settings.max_upload_mb} MB limit"
            save_job(job)
            return job
        dest.write_bytes(content)
        job.filename = file.filename
        job.source_media = str(dest)
        save_job(job)

    if transcript_text and transcript_text.strip():
        transcript_path = UPLOAD_DIR / f"{job_id}-transcript.txt"
        transcript_path.write_text(transcript_text.strip(), encoding="utf-8")
        job.filename = "pasted-transcript.txt"
        save_job(job)

    await enqueue_job(job_id)
    return load_job(job_id) or job


def run_job_sync(job_id: str) -> None:
    """Worker entrypoint: transcribe → RAG → Gemini generation."""
    job = load_job(job_id)
    if not job or job.status == JobStatus.completed:
        return

    job.status = JobStatus.processing
    save_job(job)
    logger.info(f"Processing job: {job_id}")

    try:
        text, segments, source_media = _resolve_input(job)
        job.transcript = text
        job.segments = segments
        if source_media:
            job.source_media = source_media
        logger.info(f"Transcription complete: {job_id} ({len(text)} chars, {len(segments)} segments)")
        
        job.content_kit = build_content_kit(text, segments, niche=job.niche, language=job.language)
        job.status = JobStatus.completed
        job.demo = not settings.is_live
        logger.info(f"Job completed successfully: {job_id} (mode: {'live' if settings.is_live else 'demo'})")
    except Exception as exc:  # noqa: BLE001
        job.status = JobStatus.failed
        job.error = str(exc)
        logger.error(f"Job failed: {job_id} - {str(exc)}", exc_info=True)

    save_job(job)


def _resolve_input(job: JobResult) -> tuple[str, list, str | None]:
    transcript_path = UPLOAD_DIR / f"{job.job_id}-transcript.txt"
    if transcript_path.exists():
        text = transcript_path.read_text(encoding="utf-8")
        t, segs = transcribe_text_paste(text)
        return t, segs, None

    if job.youtube_url and is_youtube_url(job.youtube_url):
        media, title = download_youtube_audio(job.youtube_url, job.job_id, UPLOAD_DIR)
        job.filename = title
        text, segments = transcribe_file(media, language=job.language or None)
        return text, segments, str(media)

    if job.source_media:
        media = Path(job.source_media)
        text, segments = transcribe_file(media, language=job.language or None)
        return text, segments, str(media)

    raise ValueError("Provide a YouTube URL, video/audio file, or paste a transcript")
