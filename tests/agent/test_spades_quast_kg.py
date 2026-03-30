"""
Core-level tests for SpadesQuastKnowledgeGraph.

Focus:
- Intent analysis from natural language.
- Generated default parameters and command previews.

Run:
    pytest tests/agent/test_spades_quast_kg.py
"""

from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_AGENT = ROOT / "backend-agent"
sys.path.insert(0, str(BACKEND_AGENT))


@pytest.mark.skipif(
    not (BACKEND_AGENT / "core" / "spades_quast_kg.py").exists(),
    reason="backend-agent/core/spades_quast_kg.py not found",
)
def test_intent_analysis_matches_spades_quast_pipeline():
    from core.spades_quast_kg import SpadesQuastKnowledgeGraph  # type: ignore

    kg = SpadesQuastKnowledgeGraph(kg_file=None)
    query = (
        "I have paired-end fastq reads and want to assemble a bacterial genome and "
        "evaluate assembly quality."
    )

    analysis = kg.analyze_user_intent(query)

    # Should detect both assembly + quality intent and map to spades+quast workflow
    assert analysis["has_assembly_intent"] is True
    assert analysis["has_quality_intent"] is True
    assert analysis["matched_workflow"] == "spades_quast_pipeline"
    assert analysis["confidence_score"] > 0.0
    assert analysis["suggested_parameters"]
    assert len(analysis["command_preview"]) == 2
    assert "spades.py" in analysis["command_preview"][0]
    assert "quast.py" in analysis["command_preview"][1]


@pytest.mark.skipif(
    not (BACKEND_AGENT / "core" / "spades_quast_kg.py").exists(),
    reason="backend-agent/core/spades_quast_kg.py not found",
)
def test_generate_workflow_definition_shape():
    from core.spades_quast_kg import SpadesQuastKnowledgeGraph  # type: ignore

    kg = SpadesQuastKnowledgeGraph(kg_file=None)
    wf = kg.generate_workflow_definition()

    assert "nodes" in wf and "connections" in wf
    assert isinstance(wf["nodes"], list) and len(wf["nodes"]) >= 4
    node_components = {n["component"] for n in wf["nodes"] if "component" in n}
    assert "spades" in node_components
    assert "quast" in node_components

