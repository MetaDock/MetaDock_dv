# MetaDock Node API

This page documents current Node endpoints implemented in `backend-node/routes/*.js`.

Base URL (default): `http://127.0.0.1:3000`

## Chat flow sequence

```text
Frontend -> Node /api/agent/ask -> Agent /ask (SSE) -> Node streams back -> Frontend
```

## Workflow flow sequence

```text
Frontend -> Node /api/run-generic-workflow -> returns jobId
Frontend -> Node /api/workflow-status/:jobId (poll)
Node -> Remote SSH execute commands -> update in-memory workflowJobs
Frontend <- final status/logs
```

## Visualization flow sequence

```text
Frontend -> Node /api/viz/codegen -> Agent /viz/codegen -> generated code
Frontend -> Node /api/viz/run -> Remote server executes python -> Node returns image/html payload
```

## Agent proxy endpoints (`/api/agent/*`)

- `POST /api/agent/ask`
- `GET /api/agent/status`
- `GET /api/agent/models`
- `POST /api/agent/switch-model`
- `POST /api/agent/test-model`
- `GET /api/agent/sessions`
- `POST /api/agent/sessions/new`
- `POST /api/agent/sessions/:sessionId/load`
- `DELETE /api/agent/sessions/:sessionId`
- `POST /api/agent/sessions/save`
- `POST /api/agent/sessions/cleanup`
- `GET /api/agent/history`
- `POST /api/agent/clear-history`

### `POST /api/agent/ask`

Request:

```json
{
  "question": "How to run SPAdes with paired-end reads?",
  "sessionId": "optional-session-id"
}
```

Response:

- `200` with `text/event-stream`
- `400` if `question` missing
- `503` when agent not ready

Common 503:

```json
{
  "error": "Agent is not ready yet. Please try again in a moment.",
  "code": "AGENT_NOT_READY"
}
```

## Workflow endpoints

- `POST /api/run-workflow`
- `POST /api/run-generic-workflow`
- `GET /api/workflow-status/:jobId`
- `GET /api/workflow-jobs`
- `POST /api/run-real-spades-quast`
- `POST /api/run-mock-spades-quast`
- `POST /api/kg/workflows/add`

### `POST /api/run-generic-workflow`

Request:

```json
{
  "workingDir": "/remote/workdir",
  "commands": [
    {
      "component": "spades",
      "nodeId": "node_1",
      "command": "spades.py -1 left.fastq.gz -2 right.fastq.gz -o spades_out",
      "condaEnv": "spades_env"
    }
  ],
  "workflow": {},
  "executionPlan": {}
}
```

Immediate response:

```json
{
  "success": true,
  "message": "Workflow started in background",
  "jobId": "workflow_...",
  "status": "running"
}
```

Notes:

- Execution is asynchronous; poll `GET /api/workflow-status/:jobId`.
- Job state is in-memory (`workflowJobs`), so restart clears jobs.

## Visualization endpoints

- `POST /api/viz/codegen`
- `POST /api/viz/run`

### `POST /api/viz/run`

Request:

```json
{
  "code": "import matplotlib.pyplot as plt\n# save to OUTPUT_PATH",
  "format": "png"
}
```

Responses:

- PNG: `imageBase64` payload
- HTML: `htmlContent` payload

## Tool metadata endpoints

- `GET /search-tools`
- `GET /api/tools`
- `GET /api/visualization-tools`
- `GET /api/tool-config/:toolName`

## File/remote browser endpoints

- `POST /upload-files` (`multipart/form-data`, field `files`, plus `currentDir`)
- `POST /download-files`
- `POST /delete-files`
- `GET /browse-remote-files`
- `GET /read-remote-file`
- `GET /api/server-files`
- `GET /api/server-folders`
- `GET /check-folder`

## Conda endpoints

- `GET /api/conda-environments`
- `GET /api/conda-test`
- `GET /api/conda-terminal`

## Common Node-side errors

- `503 AGENT_NOT_READY` from agent proxy routes before agent health is ready.
- `400` / `401` when remote SSH connection details are missing for connection-required routes.
