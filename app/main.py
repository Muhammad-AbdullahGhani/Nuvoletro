import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import ROOT, settings
from app.models import JobResult
from app.services.clip_export import ClipExportError, export_clip, ffmpeg_available
from app.services.jobs import load_job, submit_job
from app.services.rag import init_rag_store
from app.workers.pool import get_executor, start_workers

# Structured logging for production monitoring
logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await start_workers()
    try:
        init_rag_store()
    except Exception:  # noqa: BLE001 — RAG seeds on first live request if startup fails
        pass
    yield
    get_executor().shutdown(wait=False)


app = FastAPI(
    title="Nuvoletro",
    description="Automated YouTube → LinkedIn/Instagram content repurposing with Whisper, RAG, and Gemini",
    version="1.0.0",
    lifespan=lifespan,
)

STATIC_DIR = ROOT / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/landing")
def landing():
    return FileResponse(STATIC_DIR / "landing.html")


@app.get("/api/health")
def health():
    """System health check: API keys, workers, external tools, and RAG store."""
    health_data = {
        "status": "ok",
        "openai_configured": settings.has_openai,
        "gemini_configured": settings.has_gemini,
        "ffmpeg_available": ffmpeg_available(),
        "worker_count": settings.worker_count,
        "mode": "live" if settings.is_live else "demo",
        "max_upload_mb": settings.max_upload_mb,
        "pipeline": {
            "youtube_extraction": "yt-dlp ready",
            "transcription": "OpenAI Whisper" if settings.has_openai else "Demo mode",
            "rag_vectordb": "Chroma (persistent)",
            "post_generation": "Gemini 2.0 Flash" if settings.has_gemini else "Template-based",
        }
    }
    logger.info("Health check: system operational")
    return health_data


@app.post("/api/jobs", response_model=JobResult)
async def create_job(
    file: UploadFile | None = File(None),
    transcript: str | None = Form(None),
    youtube_url: str | None = Form(None),
    niche: str | None = Form(None),
    language: str = Form("en"),
):
    if not any([
        file and file.filename,
        transcript and transcript.strip(),
        youtube_url and youtube_url.strip(),
    ]):
        raise HTTPException(
            status_code=400,
            detail="Provide a YouTube URL, video/audio file, or transcript",
        )
    try:
        job = await submit_job(file, transcript, youtube_url, niche, language)
        source_desc = (file.filename if file else None) or youtube_url or "transcript"
        logger.info(f"Job created: {job.job_id} (source: {source_desc})")
        return job
    except Exception as exc:
        logger.error(f"Job creation failed: {str(exc)}", exc_info=True)
        raise HTTPException(
            status_code=422,
            detail=f"Job submission failed: {str(exc)[:200]}"
        ) from exc


@app.get("/api/jobs/{job_id}", response_model=JobResult)
def get_job(job_id: str):
    job = load_job(job_id)
    if not job:
        logger.warning(f"Job not found: {job_id}")
        raise HTTPException(status_code=404, detail="Job not found")
    logger.debug(f"Job retrieved: {job_id} (status: {job.status})")
    return job


def _kit(job: JobResult):
    return job.content_kit or job.publish_kit


@app.get("/api/jobs/{job_id}/download/srt")
def download_srt(job_id: str):
    try:
        job = load_job(job_id)
        kit = _kit(job)
        if not job or not kit:
            logger.warning(f"SRT download failed: job not found or incomplete ({job_id})")
            raise HTTPException(status_code=404, detail="Captions not found")
        path = ROOT / "data" / "exports" / f"{job_id}.srt"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(kit.captions_srt, encoding="utf-8")
        logger.info(f"SRT exported: {job_id}")
        return FileResponse(path, filename="nuvoletro-captions.srt", media_type="application/x-subrip")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"SRT download error: {str(exc)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate SRT") from exc


@app.get("/api/jobs/{job_id}/download/json")
def download_json(job_id: str):
    try:
        job = load_job(job_id)
        if not job:
            logger.warning(f"JSON download failed: job not found ({job_id})")
            raise HTTPException(status_code=404, detail="Job not found")
        path = ROOT / "data" / "exports" / f"{job_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(job.model_dump_json(indent=2), encoding="utf-8")
        logger.info(f"JSON exported: {job_id}")
        return FileResponse(path, filename="nuvoletro-content-kit.json", media_type="application/json")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"JSON download error: {str(exc)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate JSON") from exc


@app.get("/api/jobs/{job_id}/clips/{index}")
def download_clip(job_id: str, index: int, vertical: bool = True):
    try:
        job = load_job(job_id)
        kit = _kit(job)
        if not job or not kit:
            logger.warning(f"Clip export failed: job not found ({job_id})")
            raise HTTPException(status_code=404, detail="Job not found")
        clips = kit.clip_suggestions
        if index < 0 or index >= len(clips):
            logger.warning(f"Clip export failed: index out of range ({job_id}, index={index}, total={len(clips)})")
            raise HTTPException(status_code=404, detail=f"Clip index {index} out of range (0-{len(clips)-1})")
        try:
            out = export_clip(job.source_media, clips[index], job_id, index, vertical=vertical)
            logger.info(f"Clip exported: {job_id}/clip{index} ({out.stat().st_size / 1024 / 1024:.2f} MB)")
            return FileResponse(out, filename=f"nuvoletro-clip-{index + 1}.mp4", media_type="video/mp4")
        except ClipExportError as exc:
            logger.warning(f"Clip export error: {str(exc)}")
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Clip export error: {str(exc)}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to export clip") from exc
