"""
Basic agent unit tests.

- Ensure backend-agent modules can be imported from project root layout.
- Smoke test that Flask app in agent_server can be created.

Run:
    pytest tests/agent/test_agent_server_import.py
"""

from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_AGENT = ROOT / "backend-agent"


@pytest.mark.skipif(not BACKEND_AGENT.exists(), reason="backend-agent directory not found")
def test_backend_agent_on_path():
  """backend-agent should be importable as a package root."""
  sys.path.insert(0, str(BACKEND_AGENT))
  try:
    import config  # type: ignore  # noqa: F401
  finally:
    sys.path.pop(0)


@pytest.mark.skipif(
  not (BACKEND_AGENT / "api" / "agent_server.py").exists(),
  reason="backend-agent/api/agent_server.py not found",
)
def test_agent_server_creates_flask_app():
  """
  Import agent_server and verify that a Flask app object can be created.

  We avoid starting the HTTP server; this is a pure import/smoke test.
  """
  sys.path.insert(0, str(BACKEND_AGENT))
  try:
    from api import agent_server  # type: ignore

    # agent_server should expose either `app` or a factory like `create_app`.
    app = getattr(agent_server, "app", None)
    if app is None and hasattr(agent_server, "create_app"):
      app = agent_server.create_app()  # type: ignore[attr-defined]

    assert app is not None, "agent_server should expose a Flask app or factory"
  finally:
    sys.path.pop(0)

