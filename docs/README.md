# MetaDock Documentation

All docs are in English. Paths are relative to the repository root. Use Markdown for any new or edited docs.

## Document index

| Document | Description |
|----------|-------------|
| [setup-migration-guide.md](setup-migration-guide.md) | **Setup & Migration Guide** - current layout (backend-node, backend-agent, frontend, data), run commands, configuration. |
| [handover-runbook.md](handover-runbook.md) | **Handover Runbook** - one-page maintainer checklist (env, run, tests, evals, common issues). |
| [architecture.md](architecture.md) | **System Architecture** - module boundaries, data flow (RAG/workflow), key runtime components. |
| [platform-user-guide.md](platform-user-guide.md) | **Platform User Guide** - role capabilities (Administrator/Regular User) and core feature behavior. |
| [api-overview.md](api-overview.md) | **API Overview** - API docs entry page and quick links. |
| [node-api-reference.md](node-api-reference.md) | **Node API Reference** - endpoint groups, payload examples, and integration sequences. |
| [agent-api-reference.md](agent-api-reference.md) | **Agent API Reference** - Flask endpoint reference and lifecycle/error notes. |
| [prompt-assets.md](prompt-assets.md) | **Prompt Assets** - prompt files, loading conventions, and experiment mapping. |
| [evaluation-guide.md](evaluation-guide.md) | **Evaluation Guide** - datasets/scripts and experiment reproducibility mapping. |
| [writing-style-guide.md](writing-style-guide.md) | **Writing Style Guide** - documentation conventions and code-alignment checklist. |

**Recommended start:** [setup-migration-guide.md](setup-migration-guide.md) then [handover-runbook.md](handover-runbook.md).

For API endpoints, start with [api-overview.md](api-overview.md), then use [node-api-reference.md](node-api-reference.md) and [agent-api-reference.md](agent-api-reference.md).

## Conventions

- **Filenames:** Lowercase with hyphens (e.g. `setup-migration-guide.md`, `platform-user-guide.md`).
- **Headings:** Sentence case for titles; `##` for main sections.
- **Paths:** No leading slash; e.g. `backend-node/config/index.js`, `backend-agent/prompts/`.
- **Code:** Inline with backticks; multi-line in fenced blocks with language tag (`bash`, `yaml`, etc.).

## Web documentation (MkDocs)

Use MkDocs to serve this folder as a web documentation site.

1. Install dependencies:

```bash
pip install mkdocs mkdocs-material
```

2. Start local docs server from repo root:

```bash
mkdocs serve
```

3. Open:

`http://127.0.0.1:8000`
