# MetaDock Writing Style Guide

Use this guide when creating or updating docs under `docs/`.

## Scope and goals

- Keep docs aligned with real code paths and commands.
- Prefer operational clarity over marketing language.
- Make every page runnable/verifiable by a new maintainer.

## File naming and placement

- Use lowercase kebab-case filenames: `api-overview.md`, `handover-runbook.md`.
- Keep developer docs in `docs/`.
- Keep links relative (no leading slash).

## Required page structure

For technical pages, prefer this order:

1. Purpose (what this page is for)
2. Current source of truth (which code paths/scripts)
3. Commands or workflows
4. Troubleshooting / caveats
5. Related docs

## Writing rules

- Use English for all docs.
- Use sentence-case headings.
- Use short paragraphs and concrete bullet lists.
- Use present tense and active voice.
- Avoid ambiguous words like "maybe", "usually", "soon" unless necessary.

## Path and command conventions

- Wrap file paths and symbols in backticks.
- Keep commands copy-paste ready in fenced `bash` blocks.
- For OS-specific commands, label clearly:
  - Windows
  - macOS/Linux

## API documentation conventions

- Group endpoints by module (`agent`, `workflow`, `viz`, `files`, `conda`).
- Document method + path together: `POST /api/agent/ask`.
- Add one-line purpose per endpoint.
- Call out non-obvious behavior (streaming, background jobs, 503 readiness, in-memory state).

## Code alignment checklist (before merge)

- Verify runtime entrypoint in `package.json` scripts.
- Verify endpoint names in route files under `backend-node/routes/`.
- Verify agent endpoint names in `backend-agent/api/agent_server.py`.
- Verify environment variable names in `backend-node/config/index.js` and `backend-agent/config.py`.
- Verify all commands from project root unless explicitly stated otherwise.

## MkDocs conventions

- Keep top-level navigation in `mkdocs.yml`.
- Keep homepage in `docs/index.md`.
- Exclude non-site helper docs with `exclude_docs` when needed.

## Update policy

- When code changes endpoint/path/command behavior, update docs in the same PR.
- If behavior is transitional (legacy path still exists), mark it explicitly as `legacy`.
