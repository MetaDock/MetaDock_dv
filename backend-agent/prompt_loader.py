"""
Load prompt templates from backend-agent/prompts/*.yaml and build LangChain ChatPromptTemplate.
Used by adaptive_rag to keep long prompt text out of code; enables versioning and paper citation by file/line.
"""
from pathlib import Path
from typing import Dict, Any, Optional
import logging

import yaml
from langchain_core.prompts import ChatPromptTemplate

logger = logging.getLogger(__name__)

# Default prompts dir: next to this file
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


def _load_yaml(name: str, prompts_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Load a single YAML file by name (without .yaml)."""
    base = (prompts_dir or PROMPTS_DIR) / f"{name}.yaml"
    if not base.exists():
        raise FileNotFoundError(f"Prompts file not found: {base}")
    with open(base, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _messages_from_block(block: Dict[str, str], human_key: str = "human") -> list:
    """Build list of (role, template) from a block with system/human keys."""
    messages = []
    if block.get("system"):
        messages.append(("system", block["system"]))
    if block.get(human_key):
        messages.append(("human", block[human_key]))
    return messages


def load_prompts(
    name: str,
    *,
    subkey: Optional[str] = None,
    prompts_dir: Optional[Path] = None,
) -> ChatPromptTemplate:
    """
    Load a prompt from prompts/<name>.yaml and return a ChatPromptTemplate.

    - name: file base name, e.g. "routing", "grading", "rag_general".
    - subkey: key inside the YAML (e.g. "routing", "grade_document"). If None, first top-level key used.
    - prompts_dir: override directory (default: backend-agent/prompts).

    Convention in YAML:
      subkey:
        system: "..."
        human: "{question}"
    """
    data = _load_yaml(name, prompts_dir=prompts_dir)
    if subkey is None:
        # Use first key that is not a comment-like key
        skip = {"#", "version", "last_updated", "related_experiments"}
        keys = [k for k in data if isinstance(k, str) and not k.startswith("#") and k not in skip]
        if not keys:
            raise ValueError(f"No prompt block found in {name}.yaml")
        subkey = keys[0]
    block = data.get(subkey)
    if not block or not isinstance(block, dict):
        raise ValueError(f"Missing or invalid block {subkey!r} in {name}.yaml")
    messages = _messages_from_block(block)
    if not messages:
        raise ValueError(f"No system/human in block {subkey!r}")
    return ChatPromptTemplate.from_messages(messages)


def load_prompts_with_variants(
    name: str,
    subkey: str,
    *,
    variant_suffix: str = "_structured",
    text_suffix: str = "_text",
    prompts_dir: Optional[Path] = None,
) -> tuple:
    """
    Load two variants (e.g. for structured vs text output): (structured_template, text_template).
    Expects block keys like system_structured, system_text, human.
    """
    data = _load_yaml(name, prompts_dir=prompts_dir)
    block = data.get(subkey)
    if not block or not isinstance(block, dict):
        raise ValueError(f"Missing block {subkey!r} in {name}.yaml")
    human = block.get("human", "")
    sys_structured = block.get("system_structured") or block.get("system")
    sys_text = block.get("system_text") or block.get("system")
    msg_structured = [("system", sys_structured), ("human", human)] if sys_structured else []
    msg_text = [("system", sys_text), ("human", human)] if sys_text else []
    return (
        ChatPromptTemplate.from_messages(msg_structured) if msg_structured else None,
        ChatPromptTemplate.from_messages(msg_text) if msg_text else None,
    )
