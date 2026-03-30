# MetaDock Handover Runbook

One-page list for the next maintainer to get the project running and validate it. See [setup-migration-guide.md](setup-migration-guide.md) for current layout and run commands.

## 1. Environment and config

- [ ] Edit project-root `.env` and set at least: `REMOTE_WORKDIR` (or `WORKING_DIR`), `CONDA_PATH`, and API keys (`DASHSCOPE_API_KEY`, `GEMINI_API_KEY`) as needed.
- [ ] Optionally copy `config.example.json` to `config.json` and set remote host, username, and data paths.
- [ ] Ensure no personal paths (e.g. `/home/yourname`, `D:\file\...`) remain in code; use `backend-node/config/index.js` and `backend-agent/config.py` (and `.env`) instead.

## 2. Install and run

- [ ] **Node:** `npm install` (from project root).
- [ ] **Python:** Create a venv or conda env, then `pip install -r requirements.txt`. The agent is started by the Node server; ensure it can resolve `backend-agent` (e.g. run from project root).
- [ ] Start the application: `npm start` or `node backend-node/server.js` from the project root. This starts both the Node server and the Python agent.
- [ ] Confirm Node: `http://localhost:3000` (or `PORT` from `.env`). Confirm agent health: `http://127.0.0.1:5111/health`.
- [ ] Open the app in the browser; log in and confirm connection to the remote server (if used).

## 3. Optional: build RAG vector store

- [ ] If using RAG for the first time: `python backend-agent/infra/document_processor.py` from the project root (so that `backend-agent` is on the path and data paths resolve correctly).

## 4. Tests

- [ ] Run: `pytest tests/` (or `python -m pytest tests/`).
- [ ] Run key tests directly if needed:
  - `pytest tests/agent/test_agent_server_import.py`
  - `pytest tests/agent/test_workflow_planner.py`
  - `pytest tests/agent/test_spades_quast_kg.py`
  - `pytest tests/admin/test_param_extraction.py`
- [ ] Optional Node config smoke test: `node tests/node/test_node_config.js`

## 5. Evals (experiment reproducibility)

- [ ] Run a minimal RAG eval: `python evals/scripts/run_rag_eval.py` (after implementing or stubbing the eval loop).
- [ ] Run a minimal workflow eval: `node evals/scripts/run_workflow_eval.js` (after implementing API call and metrics).
- [ ] Map script + dataset to internal evaluation outputs in `docs/evaluation-guide.md`.

## 6. Key files to read

- [ ] **docs/architecture.md** – High-level architecture and module roles.
- [ ] **docs/setup-migration-guide.md** – Current layout and run instructions.
- [ ] **docs/evaluation-guide.md** – Which evals correspond to which benchmark outputs.
- [ ] **docs/prompt-assets.md** – Where prompts live and how they map to experiments.
- [ ] **backend-node/config/index.js** – Node config and paths.
- [ ] **backend-agent/config.py** – Python paths and env overrides.
- [ ] **backend-agent/prompts/*.yaml** – All main prompt text (versioned in file headers).

## 7. Common issues

- **Agent not ready (503 / ECONNREFUSED 5111):** The Python agent starts a few seconds after Node. Wait for the health check to pass, or ensure `backend-agent/api/agent_server.py` runs correctly from the project root (e.g. `python backend-agent/api/agent_server.py`). Check `AGENT_HEALTH_URL` in `.env` if you change the agent port.
- **Tool execution fails:** Check `REMOTE_WORKDIR`, `CONDA_PATH`, and SSH/connection details (host, user, password) in the login flow.
- **Prompts not found:** Run from project root or verify `backend-agent/prompts/` exists; `prompt_loader.py` resolves prompts relative to itself.
