"""
Unified Python configuration for MetaDock Agent.
Centralizes vector_store_path, memory_store_path, model defaults, and paths.
Avoid hardcoded D:\\file\\... or /home/username in code.
"""
import os
from pathlib import Path

# Project root: directory containing backend-agent/
_BACKEND_AGENT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _BACKEND_AGENT_DIR.parent

def _env(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip() or default

# Vector store and memory
VECTOR_STORE_PATH = _env("VECTOR_STORE_PATH") or str(_PROJECT_ROOT / "vector_store")
MEMORY_STORE_PATH = _env("MEMORY_STORE_PATH") or str(_PROJECT_ROOT / "backend-agent" / "memory_store")

# Knowledge graph and data
KG_FILE = _env("KG_FILE") or str(_PROJECT_ROOT / "data" / "spades_quast_kg.json")
CUSTOM_WORKFLOWS_PATH = _env("CUSTOM_WORKFLOWS_PATH") or str(_PROJECT_ROOT / "data" / "custom_workflows.json")

# Help / parameters (for document processor etc.)
DATA_DIR = _env("DATA_DIR") or str(_PROJECT_ROOT / "data")
HELP_PAGES_DIR = _env("HELP_PAGES_DIR") or str(_PROJECT_ROOT / "data" / "help_pages_for_test")
PARAMETERS_DIR = _env("PARAMETERS_DIR") or str(_PROJECT_ROOT / "data" / "parameters")

# Prompts directory (for load_prompts)
PROMPTS_DIR = _BACKEND_AGENT_DIR / "prompts"

# Model defaults (can override via env)
DEFAULT_EMBEDDING_MODEL = _env("EMBEDDING_MODEL") or "sentence-transformers/all-MiniLM-L6-v2"
