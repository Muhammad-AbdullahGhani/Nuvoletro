from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, computed_field


class JobStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    completed = "completed"
    failed = "failed"


class TranscriptSegment(BaseModel):
    start: float
    end: float
    text: str


class ClipSuggestion(BaseModel):
    start: float
    end: float
    hook: str
    reason: str


class PlatformPack(BaseModel):
    title: str
    description: str
    hashtags: list[str] = Field(default_factory=list)
    extra: dict[str, Any] = Field(default_factory=dict)


class ContentKit(BaseModel):
    """Platform-optimized promotional content generated from a video transcript."""

    linkedin: PlatformPack
    instagram: PlatformPack
    youtube: PlatformPack
    captions_srt: str
    clip_suggestions: list[ClipSuggestion] = Field(default_factory=list)
    rag_context_used: list[str] = Field(default_factory=list)


class JobResult(BaseModel):
    job_id: str
    status: JobStatus
    stage: str = "pending"
    filename: str | None = None
    source_media: str | None = None
    youtube_url: str | None = None
    niche: str | None = None
    language: str = "en"
    demo: bool = False
    error: str | None = None
    transcript: str | None = None
    segments: list[TranscriptSegment] = Field(default_factory=list)
    content_kit: ContentKit | None = None

    @computed_field
    @property
    def publish_kit(self) -> ContentKit | None:
        return self.content_kit
