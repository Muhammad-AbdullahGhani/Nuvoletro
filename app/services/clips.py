import re

from app.models import ClipSuggestion, TranscriptSegment

HOOK_PATTERNS = re.compile(
    r"\b(how to|why|mistake|secret|stop|don't|never|best|top \d|#\d|today|here's)\b",
    re.I,
)


def suggest_clips(segments: list[TranscriptSegment], max_clips: int = 5) -> list[ClipSuggestion]:
    if not segments:
        return []

    scored: list[tuple[float, TranscriptSegment, str]] = []
    for seg in segments:
        text = seg.text.strip()
        if len(text.split()) < 4:
            continue
        score = 0.0
        if HOOK_PATTERNS.search(text):
            score += 2.0
        if "?" in text:
            score += 1.0
        if len(text.split()) <= 18:
            score += 0.5
        score += min(1.0, len(text) / 120)
        reason = "Strong hook pattern" if score >= 2 else "Good short-form segment"
        scored.append((score, seg, reason))

    scored.sort(key=lambda x: x[0], reverse=True)
    picks: list[ClipSuggestion] = []
    used_ranges: list[tuple[float, float]] = []

    for _, seg, reason in scored:
        start = max(0.0, seg.start - 1.0)
        end = seg.end + 2.0
        duration = end - start
        if duration < 15 or duration > 60:
            if duration > 60:
                end = start + 45
            elif duration < 15:
                end = start + 20
        overlap = any(not (end <= s or start >= e) for s, e in used_ranges)
        if overlap:
            continue
        picks.append(
            ClipSuggestion(
                start=round(start, 1),
                end=round(end, 1),
                hook=seg.text[:120],
                reason=reason,
            )
        )
        used_ranges.append((start, end))
        if len(picks) >= max_clips:
            break

    return picks
