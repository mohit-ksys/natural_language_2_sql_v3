import os
import pathlib
from config.settings import settings


# Per-lms_type knowledge base files, located in subdirectories.
# Structure:
#   knowledge_base/online/knowledge_base_online.txt
#   knowledge_base/online/few_shot_online.txt
#   knowledge_base/regular/regular_kb.txt
#   knowledge_base/regular/few_shot_regular.txt
KB_FILES: dict[str, str] = {
    "online": "online/knowledge_base_online.txt",
    "regular": "regular/regular_kb.txt",
}
FEW_SHOT_FILES: dict[str, str] = {
    "online": "online/few_shot_online.txt",
    "regular": "regular/few_shot_regular.txt",
}
KB_FALLBACK = "new_kb.txt"

# Separate cache per lms_type key
_cache: dict[str, str] = {}


def reload_knowledge_base(lms_type: str = "online") -> str:
    """Force-reload the knowledge base for a given lms_type, bypassing cache."""
    _cache.pop(lms_type, None)
    return get_knowledge_base_prompt(lms_type=lms_type)


def get_knowledge_base_prompt(lms_type: str = "online", force_reload: bool = False) -> str:
    """Return the knowledge base prompt for the given lms_type.

    Looks for knowledge_base/<lms_type>/<kb_file> first, falls back to
    new_kb.txt so existing deployments keep working without any file changes.
    """
    cache_key = lms_type or "online"

    if force_reload or os.environ.get("RELOAD_KB") == "1":
        _cache.pop(cache_key, None)

    if cache_key in _cache:
        return _cache[cache_key]

    kb_dir = pathlib.Path(settings.KNOWLEDGE_BASE_DIR)

    # Prefer the lms_type-specific file; fall back to the default
    preferred = KB_FILES.get(cache_key, f"{cache_key}/{cache_key}_kb.txt")
    kb_path = kb_dir / preferred
    if not kb_path.exists():
        kb_path = kb_dir / KB_FALLBACK
    if not kb_path.exists():
        raise FileNotFoundError(f"Knowledge base file not found: {kb_path}")

    few_shot_preferred = FEW_SHOT_FILES.get(cache_key)
    few_shot_path = kb_dir / few_shot_preferred if few_shot_preferred else None
    few_shot = few_shot_path.read_text(encoding="utf-8") if few_shot_path and few_shot_path.exists() else ""

    prompt = kb_path.read_text(encoding="utf-8") + ("\n\n" + few_shot if few_shot else "")
    _cache[cache_key] = prompt
    return prompt
