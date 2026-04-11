import pathlib
from config.settings import settings


# Per-lms_type subdirectory config: (kb_filename, few_shot_filename)
KB_CONFIG: dict[str, tuple[str, str]] = {
    "online": ("knowledge_base_online.txt", "few_shot_online.txt"),
    "regular": ("regular_kb.txt", "few_shot_regular.txt"),
}

# Separate cache per lms_type key
_cache: dict[str, str] = {}


def reload_knowledge_base(lms_type: str = "online") -> str:
    """Force-reload the knowledge base for a given lms_type, bypassing cache."""
    _cache.pop(lms_type, None)
    return get_knowledge_base_prompt(lms_type=lms_type)


def get_knowledge_base_prompt(lms_type: str = "online", force_reload: bool = False) -> str:
    """Return the knowledge base prompt for the given lms_type.

    Reads from knowledge_base/<lms_type>/ subdirectory using the
    filenames defined in KB_CONFIG.
    """
    import os

    cache_key = lms_type or "online"

    if force_reload or os.environ.get("RELOAD_KB") == "1":
        _cache.pop(cache_key, None)

    if cache_key in _cache:
        return _cache[cache_key]

    if cache_key not in KB_CONFIG:
        raise ValueError(f"Unknown lms_type '{cache_key}'. Expected one of: {list(KB_CONFIG)}")

    kb_filename, few_shot_filename = KB_CONFIG[cache_key]
    kb_dir = pathlib.Path(settings.KNOWLEDGE_BASE_DIR) / cache_key

    kb_path = kb_dir / kb_filename
    if not kb_path.exists():
        raise FileNotFoundError(f"Knowledge base file not found: {kb_path}")

    few_shot_path = kb_dir / few_shot_filename
    few_shot = few_shot_path.read_text(encoding="utf-8") if few_shot_path.exists() else ""

    prompt = kb_path.read_text(encoding="utf-8") + ("\n\n" + few_shot if few_shot else "")
    _cache[cache_key] = prompt
    return prompt
