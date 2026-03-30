/**
 * Agent API proxy routes: /api/agent/*
 * When agent is not listening yet (ECONNREFUSED), return 503 with a short message.
 */
const axios = require('axios');

const AGENT_BASE = 'http://127.0.0.1:5111';

function isAgentUnavailable(err) {
  return err.code === 'ECONNREFUSED' || err.errno === -4078 || (err.cause && isAgentUnavailable(err.cause));
}

function handleAgentError(err, res, fallbackMessage) {
  if (isAgentUnavailable(err)) {
    console.warn('Agent not ready (ECONNREFUSED 5111)');
    return res.status(503).json({
      error: 'Agent is not ready yet. Please try again in a moment.',
      code: 'AGENT_NOT_READY'
    });
  }
  if (err.response) {
    return res.status(err.response.status || 500).json(err.response.data || { error: fallbackMessage });
  }
  console.error(fallbackMessage, err.message);
  return res.status(500).json({ error: fallbackMessage });
}

function registerAgentRoutes(app) {
  app.post('/api/agent/ask', async (req, res) => {
    const { question, sessionId } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });
    if (!app.locals.isAgentReady) {
      return res.status(503).json({ error: 'Agent is not ready yet. Please try again in a moment.' });
    }
    try {
      const agentResponse = await axios({
        method: 'post',
        url: `${AGENT_BASE}/ask`,
        data: { question, sessionId },
        responseType: 'stream'
      });
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      agentResponse.data.pipe(res);
      agentResponse.data.on('error', (err) => {
        console.error('Error in agent stream:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Error in agent stream' });
        res.end();
      });
    } catch (error) {
      if (!res.headersSent) handleAgentError(error, res, 'Failed to communicate with agent');
    }
  });

  app.get('/api/agent/status', (req, res) => {
    res.json({ ready: app.locals.isAgentReady });
  });

  app.get('/api/agent/models', async (req, res) => {
    if (!app.locals.isAgentReady) {
      return res.status(503).json({
        error: 'Agent is not ready yet. Please try again in a moment.',
        code: 'AGENT_NOT_READY',
        ready: false
      });
    }
    try {
      const response = await axios.get(`${AGENT_BASE}/models`);
      res.json(response.data);
    } catch (error) {
      handleAgentError(error, res, 'Failed to get models');
    }
  });

  app.post('/api/agent/switch-model', async (req, res) => {
    try {
      const response = await axios.post(`${AGENT_BASE}/switch-model`, req.body);
      res.json(response.data);
    } catch (error) {
      handleAgentError(error, res, 'Failed to switch model');
    }
  });

  app.post('/api/agent/test-model', async (req, res) => {
    try {
      const response = await axios.post(`${AGENT_BASE}/test-model`, req.body);
      res.json(response.data);
    } catch (error) {
      handleAgentError(error, res, 'Failed to test model');
    }
  });

  app.get('/api/agent/sessions', async (req, res) => {
    if (!app.locals.isAgentReady) {
      return res.status(503).json({ error: 'Agent is not ready yet.', code: 'AGENT_NOT_READY', ready: false });
    }
    try {
      const response = await axios.get(`${AGENT_BASE}/sessions`);
      res.json(response.data);
    } catch (error) {
      handleAgentError(error, res, 'Failed to get sessions list');
    }
  });

  app.post('/api/agent/sessions/new', async (req, res) => {
    try {
      const response = await axios.post(`${AGENT_BASE}/sessions/new`, { session_id: req.body.sessionId });
      res.json(response.data);
    } catch (error) {
      handleAgentError(error, res, 'Failed to start new session');
    }
  });

  app.post('/api/agent/sessions/:sessionId/load', async (req, res) => {
    try {
      const response = await axios.post(`${AGENT_BASE}/sessions/${req.params.sessionId}/load`);
      res.json(response.data);
    } catch (error) {
      if (error.response && error.response.status === 404) res.status(404).json({ error: 'Session not found' });
      else handleAgentError(error, res, 'Failed to load session');
    }
  });

  app.delete('/api/agent/sessions/:sessionId', async (req, res) => {
    try {
      const response = await axios.delete(`${AGENT_BASE}/sessions/${req.params.sessionId}`);
      res.json(response.data);
    } catch (error) {
      if (error.response && error.response.status === 404) res.status(404).json({ error: 'Session not found' });
      else handleAgentError(error, res, 'Failed to delete session');
    }
  });

  app.post('/api/agent/sessions/save', async (req, res) => {
    try {
      const response = await axios.post(`${AGENT_BASE}/sessions/save`);
      res.json(response.data);
    } catch (error) {
      handleAgentError(error, res, 'Failed to save current session');
    }
  });

  app.post('/api/agent/sessions/cleanup', async (req, res) => {
    try {
      const response = await axios.post(`${AGENT_BASE}/sessions/cleanup`, { days_to_keep: req.body.daysToKeep ?? 30 });
      res.json(response.data);
    } catch (error) {
      handleAgentError(error, res, 'Failed to cleanup old sessions');
    }
  });

  app.get('/api/agent/history', async (req, res) => {
    if (!app.locals.isAgentReady) {
      return res.status(503).json({ error: 'Agent is not ready yet.', code: 'AGENT_NOT_READY', ready: false });
    }
    try {
      const response = await axios.get(`${AGENT_BASE}/history`);
      res.json(response.data);
    } catch (error) {
      handleAgentError(error, res, 'Failed to get conversation history');
    }
  });

  app.post('/api/agent/clear-history', async (req, res) => {
    try {
      const response = await axios.post(`${AGENT_BASE}/clear-history`);
      res.json(response.data);
    } catch (error) {
      handleAgentError(error, res, 'Failed to clear conversation history');
    }
  });
}

module.exports = { registerAgentRoutes };
