import pathlib
from config.settings import settings


# Per-kb_category subdirectory config: (kb_filename, few_shot_filename)
KB_CONFIG: dict[str, tuple[str, str]] = {
    "online": ("knowledge_base_online.txt", "few_shot_online.txt"),
    "regular": ("regular_kb.txt", "few_shot_regular.txt"),
}

# Cache keyed by database_id
_cache: dict[str, str] = {}


def reload_knowledge_base(database_id: str = "degreefyd_online_lms") -> str:
    """Force-reload the knowledge base for a given database_id, bypassing cache."""
    _cache.pop(database_id, None)
    return get_knowledge_base_prompt(database_id=database_id)


def get_knowledge_base_prompt(database_id: str = "degreefyd_online_lms", force_reload: bool = False) -> str:
    """Return the knowledge base prompt for the given database_id.

    Resolves database_id → kb_category ('online' or 'regular') via settings.DATABASE_MAP,
    then reads from knowledge_base/<kb_category>/ using the filenames in KB_CONFIG.
    """
    import os

    cache_key = database_id or "degreefyd_online_lms"

    if force_reload or os.environ.get("RELOAD_KB") == "1":
        _cache.pop(cache_key, None)

    if cache_key in _cache:
        return _cache[cache_key]

    kb_category = settings.get_kb_category(cache_key)  # raises ValueError for unknown IDs

    if kb_category not in KB_CONFIG:
        raise ValueError(f"No KB config for category '{kb_category}'. Expected one of: {list(KB_CONFIG)}")

    kb_filename, few_shot_filename = KB_CONFIG[kb_category]
    kb_dir = pathlib.Path(settings.KNOWLEDGE_BASE_DIR) / kb_category

    kb_path = kb_dir / kb_filename
    if not kb_path.exists():
        raise FileNotFoundError(f"Knowledge base file not found: {kb_path}")

    few_shot_path = kb_dir / few_shot_filename
    few_shot = few_shot_path.read_text(encoding="utf-8") if few_shot_path.exists() else ""

    prompt = kb_path.read_text(encoding="utf-8") + ("\n\n" + few_shot if few_shot else "")
    _cache[cache_key] = prompt
    return prompt
