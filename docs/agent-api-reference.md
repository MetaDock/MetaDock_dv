# MetaDock Agent API

This page documents current Python agent endpoints implemented in `backend-agent/api/agent_server.py`.

Base URL (default): `http://127.0.0.1:5111`

## Initialization and readiness sequence

```text
Node starts agent process -> agent initializes vector store + BioinfoAgent -> /health becomes status=ok
```

## Chat sequence (direct agent)

```text
Client -> POST /ask (question, sessionId?) -> agent stream chunks -> client consumes SSE
```

## Core endpoints

- `POST /ask`
- `GET /health`
- `GET /status`
- `GET /tools`
- `POST /update-documents`
- `GET /debug`

### `POST /ask`

Request:

```json
{
  "question": "Explain QUAST N50.",
  "sessionId": "optional-session-id"
}
```

Response:

- `200` with `text/event-stream`
- `400` invalid body (`question` missing)
- `503` when agent not initialized

## Session and history endpoints

- `GET /history`
- `POST /clear-history`
- `GET /sessions`
- `POST /sessions/new`
- `POST /sessions/<session_id>/load`
- `DELETE /sessions/<session_id>`
- `POST /sessions/save`
- `POST /sessions/cleanup`

### `POST /sessions/cleanup`

Request:

```json
{
  "days_to_keep": 30
}
```

Response:

```json
{
  "success": true,
  "message": "Cleaned up X old sessions",
  "deleted_count": 0
}
```

## Model and workflow-planning endpoints

- `GET /models`
- `POST /switch-model`
- `POST /test-model`
- `GET /workflow-plan`
- `POST /workflow-plan/clear`

### `POST /test-model`

Request:

```json
{
  "model": "qwen-plus",
  "api_key": "your_key"
}
```

Notes:

- Ollama models do not require API key.
- On success returns connection test snippet.

## Visualization and KG endpoints

- `POST /viz/codegen`
- `POST /kg/enrich`
- `POST /kg/reload`

### `POST /kg/enrich`

Minimum request:

```json
{
  "id": "wf_id",
  "name": "workflow name",
  "nodes": [],
  "connections": []
}
```

Behavior:

- Uses LLM to enrich workflow metadata to KG-compatible structure.
- Returns `400` if required fields are missing.

## Common agent-side errors

- `503` if `agent` is not initialized.
- `500` for internal model or parsing errors (e.g. invalid JSON from enrichment generation).
