# MetaDock API Reference

API docs are now split into two focused pages:

- `node-api-reference.md` - Node backend endpoints (`backend-node/routes/*.js`)
- `agent-api-reference.md` - Python agent endpoints (`backend-agent/api/agent_server.py`)

## Quick links

- [Node API](node-api-reference.md)
- [Agent API](agent-api-reference.md)

## Service base URLs

- Node API (default): `http://127.0.0.1:3000`
- Python Agent (default): `http://127.0.0.1:5111`

## Quick smoke checks

```bash
curl http://127.0.0.1:3000/api/agent/status
curl http://127.0.0.1:5111/health
```
