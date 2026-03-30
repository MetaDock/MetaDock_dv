# MetaDock Setup and Migration Guide

This document describes the current project layout after backend modularization.
Use this page as the source of truth for runtime entrypoints and run commands.

## Current layout

| Directory | Contents |
|-----------|----------|
| **backend-node/** | Active Node.js application entrypoint: `backend-node/server.js`, plus `config/`, `handlers/`, `middleware/`, `lib/`, `routes/`, `services/`, `admin/`. |
| **backend-agent/** | Python agent: `core/`, `infra/`, `api/agent_server.py`, `prompts/`, `config.py`, `prompt_loader.py`. |
| **frontend/** | `public/` (static, views, EJS), `components/`. Served by backend-node. |
| **data/** | `help_pages_for_test/`, `parameters/`, `spades_quast_kg.json`, `custom_workflows.json`. |
| **evals/** | `datasets/`, `scripts/` for RAG and workflow evaluation. |
| **tests/** | Unit and integration tests. |
| **docs/** | All project documentation (this folder). |

`package.json` uses `backend-node/server.js` for `npm start`.
Root `server.js` has been removed; use `backend-node/server.js` as the only runtime entrypoint.

## How to run

From the project root:

```bash
# 1. Install dependencies
npm install
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate
pip install -r requirements.txt

# 2. Configure environment
# Edit .env directly in project root (file already exists in this repo).
# Set at least: REMOTE_WORKDIR (or WORKING_DIR), CONDA_PATH, and model API keys.

# 3. (Optional) Build vector store for RAG
python backend-agent/infra/document_processor.py

# 4. Start the application
npm start
# or: node backend-node/server.js
```

The Node server starts the Python agent automatically (`backend-agent/api/agent_server.py`). App: `http://localhost:3000` (or `PORT` in `.env`). Agent health: `http://127.0.0.1:5111/health`.

## Configuration

- **Node:** `backend-node/config/index.js` — port, session secret, `REMOTE_WORKDIR`, `CONDA_PATH`, `VIZ_*`, paths, `agentScript`, `agentHealthUrl`. Loads `.env` from project root.
- **Python:** `backend-agent/config.py` — `VECTOR_STORE_PATH`, `MEMORY_STORE_PATH`, `KG_FILE`, `CUSTOM_WORKFLOWS_PATH`, `DATA_DIR`, `HELP_PAGES_DIR`, `PARAMETERS_DIR`, `EMBEDDING_MODEL`.
- **Env:** Edit project-root `.env`; do not commit secrets.

## Legacy directories

If you still have old root-level **agent/** or **admin/** directories from previous iterations, treat them as legacy. Active runtime code is under **backend-node/** and **backend-agent/**.
