from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT / "uploads"
JOBS_DIR = ROOT / "data" / "jobs"
CHROMA_DIR = ROOT / "data" / "chroma"
RAG_PLAYBOOKS_DIR = ROOT / "data" / "rag" / "playbooks"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    openai_api_key: str | None = None
    gemini_api_key: str | None = None
    max_upload_mb: int = 500
    worker_count: int = 4
    demo_mode: bool = False

    @property
    def has_openai(self) -> bool:
        return bool(self.openai_api_key and self.openai_api_key.strip())

    @property
    def has_gemini(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_api_key.strip())

    @property
    def is_live(self) -> bool:
        return self.has_openai and self.has_gemini


settings = Settings()

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR.mkdir(parents=True, exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)
RAG_PLAYBOOKS_DIR.mkdir(parents=True, exist_ok=True)
