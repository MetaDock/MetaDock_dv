"""
WorkflowPlanner core tests.

Given natural language, the planner should:
- Suggest the right workflow pattern.
- Produce a tool order where SPAdes runs before QUAST.

Run:
    pytest tests/agent/test_workflow_planner.py
"""

import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_AGENT = ROOT / "backend-agent"

# Ensure backend-agent is importable as a package root (core.*, etc.)
sys.path.insert(0, str(BACKEND_AGENT))


def test_spades_quast_pattern():
    from core.workflow_planner import WorkflowPlanner  # type: ignore

    planner = WorkflowPlanner()
    req = (
        "I have paired-end shotgun metagenomic reads from a fecal sample and want to "
        "reconstruct contigs and do quality control."
    )
    analysis = planner.analyze_user_request(req)
    assert analysis.get("suggested_pattern") == "spades_quast_workflow"
    plan = planner.generate_workflow_plan(req)
    tool_names = [t["name"] for t in plan["workflow"]["tools"]]
    assert "spades" in tool_names
    assert "quast" in tool_names
    assert tool_names.index("spades") < tool_names.index("quast")


def test_metagenome_assembly_keywords():
    from core.workflow_planner import WorkflowPlanner  # type: ignore

    planner = WorkflowPlanner()
    analysis = planner.analyze_user_request("metagenomic assembly with quality control")
    assert analysis.get("suggested_pattern") in (
        "metagenome_assembly",
        "spades_quast_workflow",
        None,
    ) or "assembly" in analysis.get("goals", [])

