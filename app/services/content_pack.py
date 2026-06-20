import json
import logging

import google.generativeai as genai

from app.config import settings
from app.models import ClipSuggestion, ContentKit, PlatformPack, TranscriptSegment
from app.services.clips import suggest_clips
from app.services.rag import retrieve_context

logger = logging.getLogger(__name__)


def build_content_kit(
    transcript: str,
    segments: list[TranscriptSegment],
    niche: str | None = None,
    language: str = "en",
) -> ContentKit:
    logger.info(f"Building content kit: niche={niche}, language={language}")
    clips = suggest_clips(segments)
    logger.info(f"Clip suggestions generated: {len(clips)} clips")
    rag_chunks = retrieve_context(transcript, niche)
    if settings.has_gemini:
        logger.info("Using Gemini API for post generation")
        return _gemini_content_kit(transcript, segments, clips, niche, language, rag_chunks)
    logger.info("Using template-based post generation (demo mode)")
    return _template_content_kit(transcript, segments, clips, niche, rag_chunks)


def _segments_to_srt(segments: list[TranscriptSegment]) -> str:
    lines: list[str] = []
    for i, seg in enumerate(segments, start=1):
        lines.append(str(i))
        lines.append(f"{_ts(seg.start)} --> {_ts(seg.end)}")
        lines.append(seg.text)
        lines.append("")
    return "\n".join(lines)


def _ts(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds - int(seconds)) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _template_content_kit(
    transcript: str,
    segments: list[TranscriptSegment],
    clips: list[ClipSuggestion],
    niche: str | None,
    rag_chunks: list[str],
) -> ContentKit:
    topic = niche or "content growth"
    summary = transcript[:200].replace("\n", " ")
    linkedin_post = (
        f"Three lessons from my latest video on {topic}:\n\n"
        f"1) Start with a stronger hook\n"
        f"2) Repurpose for each platform — don't copy-paste\n"
        f"3) Use keywords in titles and descriptions\n\n"
        f"Key insight: {summary}...\n\n"
        "What's the hardest part of repurposing for you? Comment below."
    )
    ig_caption = (
        f"Stop posting the same caption everywhere.\n\n"
        f"Save this {topic} cheat sheet.\n\n"
        "Which platform do you struggle with most?"
    )
    yt_desc = (
        f"Practical {topic} tips from this video.\n\n{summary}...\n\n"
        "Chapters:\n0:00 Intro\n0:30 Key insight\n1:00 What to do instead"
    )

    return ContentKit(
        linkedin=PlatformPack(
            title="LinkedIn post",
            description=linkedin_post,
            hashtags=["contentstrategy", "creatoreconomy", topic.replace(" ", "")],
        ),
        instagram=PlatformPack(
            title="Instagram caption",
            description=ig_caption,
            hashtags=["reels", "creatortips", "contentstrategy", "growthtips"],
        ),
        youtube=PlatformPack(
            title=f"3 mistakes killing your {topic} reach",
            description=yt_desc,
            hashtags=["youtube", "contentcreator"],
            extra={"tags": [topic, "content creator"]},
        ),
        captions_srt=_segments_to_srt(segments) if segments else "",
        clip_suggestions=clips,
        rag_context_used=rag_chunks[:3],
    )


def _gemini_content_kit(
    transcript: str,
    segments: list[TranscriptSegment],
    clips: list[ClipSuggestion],
    niche: str | None,
    language: str,
    rag_chunks: list[str],
) -> ContentKit:
    genai.configure(api_key=settings.gemini_api_key)
    model = genai.GenerativeModel("gemini-2.0-flash")

    niche_line = niche or "general content creators"
    rag_block = "\n\n---\n".join(rag_chunks) if rag_chunks else "Use standard best practices."
    clip_json = [c.model_dump() for c in clips]

    prompt = f"""You are Nuvoletro — an automated content repurposing system.
Use the RAG context below to write platform-optimized promotional posts.

RAG context (platform playbooks):
{rag_block}

Niche: {niche_line}
Language: {language}

Video transcript:
{transcript[:12000]}

Clip suggestions (seconds):
{json.dumps(clip_json)}

Return ONLY valid JSON:
{{
  "linkedin": {{"title": "", "description": "", "hashtags": []}},
  "instagram": {{"title": "", "description": "", "hashtags": []}},
  "youtube": {{"title": "", "description": "", "hashtags": [], "extra": {{"tags": []}}}},
  "captions_srt": "full SRT subtitle file as a string"
}}

Rules:
- LinkedIn: professional insight post, 150-300 words, 3-5 hashtags
- Instagram: hook-first Reels caption, 8-15 hashtags
- YouTube: SEO title under 70 chars, chaptered description
- Ground all claims in the transcript; do not invent facts
- captions_srt must be valid SRT for the full transcript
"""

    logger.info("Calling Gemini API for platform-optimized post generation")
    response = model.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(
            temperature=0.4,
            response_mime_type="application/json",
        ),
    )
    raw_text = response.text or "{}"
    raw = json.loads(raw_text)

    kit = ContentKit(
        linkedin=PlatformPack(**raw.get("linkedin", {})),
        instagram=PlatformPack(**raw.get("instagram", {})),
        youtube=PlatformPack(**raw.get("youtube", {})),
        captions_srt=raw.get("captions_srt", ""),
        clip_suggestions=clips,
        rag_context_used=rag_chunks,
    )
    if not kit.captions_srt.strip() and segments:
        kit.captions_srt = _segments_to_srt(segments)
    logger.info(f"Gemini API response: {len(kit.linkedin.description)} chars (LinkedIn), {len(kit.instagram.description)} chars (Instagram)")
    return kit
