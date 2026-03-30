# MetaDock Architecture (Developers / Reviewers)

## System overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌──────────┐
│  Frontend   │────▶│  Node API   │────▶│  Python Agent   │────▶│  Remote Server  │────▶│  Tools   │
│  (EJS/JS)   │     │  (Express)  │     │  (Flask/RAG)    │     │  (SSH/conda)    │     │ (SPAdes…)│
└─────────────┘     └─────────────┘     └─────────────────┘     └─────────────────┘     └──────────┘
       │                    │                      │
       │                    │                      ├── adaptive_rag (routing, retrieval, grading)
       │                    │                      ├── workflow_planner / spades_quast_kg
       │                    │                      ├── SessionMemory, BioinfoAgent
       │                    │                      └── agent_client (LLM)
       │                    │
       │                    ├── routes/* (pages, auth, files, tools, conda, workflow, agent, viz)
       │                    ├── handlers/commandHandler (tool execution)
       │                    ├── lib/ (agentRunner, sshHelpers)
       │                    ├── services/workflowExecution
       │                    ├── config (tools, visualization)
       │                    └── admin (installer, tool management)
```

## Directory layout

- **backend-node/** – Express server:
  - **server.js** – Active entrypoint registered in `package.json` (`npm start`).
  - **config/** – `index.js` (ports, paths, agent script), `tools.js`, `visualization.js`.
  - **middleware/** – `checkConnection`, `checkConnectionAPI`, `requestLogger`.
  - **lib/** – `agentRunner.js` (start Python agent, health poll), `sshHelpers.js` (SSH/SFTP, remote commands, SLURM).
  - **routes/** – `pageRoutes`, `authRoutes`, `fileRoutes`, `toolRoutes`, `condaRoutes`, `workflowRoutes`, `agentRoutes`, `vizRoutes`.
  - **services/** – `workflowExecution.js` (validate workflow, execute nodes, build commands).
  - **handlers/** – `commandHandler.js` (tool execution).
  - **admin/** – Routes, controllers, services, views, scripts, data (installer and tool management).
- **backend-agent/** – Python agent:
  - **core/** – `adaptive_rag.py`, `bioinfo_agent.py`, `workflow_planner.py`, `session_memory.py`, `spades_quast_kg.py`.
  - **infra/** – `agent_client.py`, `document_processor.py`.
  - **api/** – `agent_server.py` (Flask app, health, ask, models, sessions, viz, kg).
  - **prompts/** – YAML files (routing, grading, rag_general, workflow_planning, viz_codegen).
  - **config.py**, **prompt_loader.py**.
- **frontend/** – `public/` (static, views), `components/`. Served by Node via `appConfig.paths.frontendPublic`.
- **data/** – `help_pages_for_test/`, `parameters/`, `spades_quast_kg.json`, `custom_workflows.json`.
- **evals/** – Evaluation datasets and scripts (experiment reproducibility).
- **tests/** – Unit and integration tests.

> Runtime entrypoint: `backend-node/server.js` (via `npm start`).

## Main modules

| Module | Role |
|--------|------|
| **adaptive_rag** | Query routing (vectorstore / web_search / general_llm), document retrieval, grading, hallucination check, answer quality, query rewrite. Prompts loaded from `backend-agent/prompts/*.yaml`. |
| **workflow_planner** | Analyzes user intent, suggests workflow pattern (e.g. spades_quast_workflow), builds tool list and connections. |
| **spades_quast_kg** | Knowledge graph for SPAdes+QUAST pipeline: intent matching, suggested parameters, command preview. |
| **SessionMemory** | Per-session conversation and workflow state. |
| **workflowExecution** (Node) | Validate workflow, topological order, execute nodes (file-input, tool, visualization, file-output), build tool commands. Used by `workflowRoutes` and run-workflow API. |
| **workflowJobs** (Node) | In-memory job store for run-generic-workflow; status and list APIs. |
| **commandHandler** (Node) | Tool execution (SSH/conda, cluster SLURM). |

## Configuration

- **Node:** `backend-node/config/index.js` – port, session secret, `REMOTE_WORKDIR`, `CONDA_PATH`, `VIZ_*`, paths (frontend, data, parameters, help pages, temp), `agentScript`, `agentHealthUrl`. Loads `.env` from project root.
- **Python:** `backend-agent/config.py` – `VECTOR_STORE_PATH`, `MEMORY_STORE_PATH`, `KG_FILE`, `CUSTOM_WORKFLOWS_PATH`, `DATA_DIR`, `HELP_PAGES_DIR`, `PARAMETERS_DIR`, `EMBEDDING_MODEL`.
- **Env:** project-root `.env`; do not commit secrets.

## Data flow (RAG question)

1. User sends question from frontend → Node proxy (`/api/agent/ask`) → Agent stream endpoint.
2. Agent: `adaptive_rag.route_question()` → vectorstore / web_search / general_llm.
3. If vectorstore: retrieve docs → grade docs → generate answer → hallucination check → answer grade; optionally rewrite and retry.
4. Response (and sources) streamed back to frontend.

## Data flow (workflow)

1. User describes goal in natural language → Agent workflow planning API.
2. `workflow_planner` or KG matches pattern (e.g. spades_quast_workflow), returns tools + connections + default params.
3. Frontend builds workflow graph; user can edit and run.
4. Node submits execution via workflow routes; job state and logs via workflowJobs.

## Key API surface (current)

- **Node proxy to agent:** `/api/agent/*` (e.g. `/api/agent/ask`, `/api/agent/models`, `/api/agent/sessions`).
- **Workflow execution (Node):** `/api/run-workflow`, `/api/run-generic-workflow`, `/api/workflow-status/:jobId`, `/api/workflow-jobs`.
- **Agent Flask endpoints:** `/ask`, `/health`, `/models`, `/switch-model`, `/sessions/*`, `/workflow-plan`, `/viz/codegen`, `/kg/enrich`, `/kg/reload`.
