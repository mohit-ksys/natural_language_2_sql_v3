import os
import pathlib
from config.settings import settings


# Per-lms_type knowledge base files.
# Add "regular_kb.txt" to the knowledge_base/ directory to give the regular
# LMS its own schema context. Falls back to new_kb.txt if not found.
KB_FILES: dict[str, str] = {
    "online": "new_kb.txt",
    "regular": "regular_kb.txt",
}
KB_FALLBACK = "new_kb.txt"
FEW_SHOT_FILE = "few_shot_examples.txt"

# Separate cache per lms_type key
_cache: dict[str, str] = {}


def reload_knowledge_base(lms_type: str = "online") -> str:
    """Force-reload the knowledge base for a given lms_type, bypassing cache."""
    _cache.pop(lms_type, None)
    return get_knowledge_base_prompt(lms_type=lms_type)


def get_knowledge_base_prompt(lms_type: str = "online", force_reload: bool = False) -> str:
    """Return the knowledge base prompt for the given lms_type.

    Looks for  knowledge_base/<lms_type>_kb.txt  first, falls back to
    new_kb.txt so existing deployments keep working without any file changes.
    """
    cache_key = lms_type or "online"

    if force_reload or os.environ.get("RELOAD_KB") == "1":
        _cache.pop(cache_key, None)

    if cache_key in _cache:
        return _cache[cache_key]

    kb_dir = pathlib.Path(settings.KNOWLEDGE_BASE_DIR)

    # Prefer the lms_type-specific file; fall back to the default
    preferred = KB_FILES.get(cache_key, f"{cache_key}_kb.txt")
    kb_path = kb_dir / preferred
    if not kb_path.exists():
        kb_path = kb_dir / KB_FALLBACK
    if not kb_path.exists():
        raise FileNotFoundError(f"Knowledge base file not found: {kb_path}")

    few_shot_path = kb_dir / FEW_SHOT_FILE
    few_shot = few_shot_path.read_text(encoding="utf-8") if few_shot_path.exists() else ""

    prompt = kb_path.read_text(encoding="utf-8") + ("\n\n" + few_shot if few_shot else "")
    _cache[cache_key] = prompt
    return prompt
