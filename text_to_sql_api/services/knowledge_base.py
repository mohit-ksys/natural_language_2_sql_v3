import os
import pathlib
from config.settings import settings


KB_FILE = "new_kb.txt"
FEW_SHOT_FILE = "few_shot_examples.txt"

_cached_prompt: str | None = None


def reload_knowledge_base() -> str:
    """Force-reload the knowledge base from disk, bypassing the cache."""
    global _cached_prompt
    _cached_prompt = None
    return get_knowledge_base_prompt()


def get_knowledge_base_prompt(force_reload: bool = False) -> str:
    global _cached_prompt
    # Reload if forced, or if RELOAD_KB env var is set to '1'
    if force_reload or os.environ.get("RELOAD_KB") == "1":
        _cached_prompt = None

    if _cached_prompt is not None:
        return _cached_prompt

    kb_dir = pathlib.Path(settings.KNOWLEDGE_BASE_DIR)

    kb_path = kb_dir / KB_FILE
    if not kb_path.exists():
        raise FileNotFoundError(f"Knowledge base file not found: {kb_path}")

    few_shot_path = kb_dir / FEW_SHOT_FILE
    few_shot = few_shot_path.read_text(encoding="utf-8") if few_shot_path.exists() else ""

    _cached_prompt = kb_path.read_text(encoding="utf-8") + ("\n\n" + few_shot if few_shot else "")
    return _cached_prompt
