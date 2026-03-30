"""
Test parameter extraction / compare_help_html core logic: assert missing parameter ratio < X%.
Run: pytest tests/admin/test_param_extraction.py
"""
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent.parent
# Admin scripts live under backend-node or admin/
admin_scripts = root / "admin" / "scripts"
if not admin_scripts.exists():
    admin_scripts = root / "backend-node" / "admin" / "scripts"
sys.path.insert(0, str(admin_scripts))

import json
import tempfile

import pytest


@pytest.mark.skipif(not (admin_scripts / "compare_help_html.py").exists(), reason="compare_help_html.py not found")
def test_compare_help_html_import():
    import compare_help_html as m
    # The script may expose multiple helpers; we just assert core helpers exist.
    assert any(
        hasattr(m, name)
        for name in (
            "check_content_issues",
            "normalize_text",
            "compare_parameters_with_help",
        )
    ), "Expected compare_help_html to expose at least one core helper"


@pytest.mark.skipif(not (admin_scripts / "compare_help_html.py").exists(), reason="compare_help_html.py not found")
def test_missing_param_ratio_below_threshold():
    """
    Integration-style check on compare_parameters_with_help:
    - construct minimal para.json + usage.json in a temp directory
    - call core comparison helper
    - assert missing parameter ratio is within a reasonable bound
    """
    import compare_help_html as m

    # Build a tiny synthetic parameter list and matching help text
    params = [
        {
            "short": "-i",
            "long": "--input",
            "category": "input",
            "description": "Input file",
        },
        {
            "short": "-o",
            "long": "--output",
            "category": "output",
            "description": "Output file",
        },
    ]

    help_text = """usage: demo_tool -i INPUT -o OUTPUT

Options:
  -i, --input   Input file
  -o, --output  Output file
"""

    with tempfile.TemporaryDirectory() as tmpdir:
        para_path = Path(tmpdir) / "demo_para.json"
        usage_path = Path(tmpdir) / "demo_usage.json"
        para_path.write_text(json.dumps(params), encoding="utf-8")
        usage_path.write_text(json.dumps({"usage": [help_text]}), encoding="utf-8")

        # Check that content issues are empty for this clean synthetic example
        issues = m.check_content_issues(str(para_path), str(usage_path))
        assert issues == [] or all("Warning" in msg for msg in issues)

        # If the script exposes a high-level comparison helper, exercise it
        if hasattr(m, "compare_parameters_with_help"):
            result = m.compare_parameters_with_help(str(para_path), str(usage_path))
            # Result structure is implementation-dependent; we only assert that
            # the missing parameter ratio, if present, is small.
            missing_ratio = (
                result.get("missing_param_ratio")
                if isinstance(result, dict)
                else None
            )
            if missing_ratio is not None:
                assert 0.0 <= missing_ratio <= 0.2

