/**
 * Unified Node configuration - single entry for .env, ports, paths.
 * Replace hardcoded /home/user and D:\file\... with values from here.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..', '..');
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('SESSION_SECRET is required. Set it in project-root .env before starting the server.');
}

// Prefer frontend/public when present, else fallback to root public/ (backward compat)
const frontendPublicDir = path.join(projectRoot, 'frontend', 'public');
const legacyPublicDir = path.join(projectRoot, 'public');
const frontendPublic = fs.existsSync(frontendPublicDir) ? frontendPublicDir : legacyPublicDir;
const frontendViews = path.join(frontendPublic, 'views');
const adminViews = path.join(projectRoot, 'backend-node', 'admin', 'views');

// Prefer data/ when present (parameters, help_pages, etc.), else fallback to root siblings
const dataDir = path.join(projectRoot, 'data');
const dataDirExists = fs.existsSync(dataDir);
const parametersDir = dataDirExists ? path.join(dataDir, 'parameters') : path.join(projectRoot, 'parameters');
const helpPagesDir = dataDirExists ? path.join(dataDir, 'help_pages_for_test') : path.join(projectRoot, 'help_pages_for_test');
if (dataDirExists && !fs.existsSync(parametersDir)) {
  try { fs.mkdirSync(parametersDir, { recursive: true }); } catch (_) {}
}

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  sessionSecret,
  nodeEnv: process.env.NODE_ENV || 'development',

  workingDir: process.env.REMOTE_WORKDIR || process.env.WORKING_DIR || '/home/user',
  condaPath: process.env.CONDA_PATH || '/home/user/miniconda3',
  vizRemoteTmp: process.env.VIZ_REMOTE_TMP || path.join(process.env.REMOTE_WORKDIR || '/home/user', 'tmp', 'metadock_viz'),
  vizMaxRuntime: parseInt(process.env.VIZ_MAX_RUNTIME || '60', 10),
  vizPython: process.env.VIZ_PYTHON || 'python3',

  projectRoot,
  paths: {
    frontendPublic,
    frontendViews,
    adminViews,
    data: dataDir,
    parameters: parametersDir,
    helpPages: helpPagesDir,
    tempUploads: path.join(projectRoot, 'backend-node', 'temp_uploads'),
  },

  agentScript: path.join(projectRoot, 'backend-agent', 'api', 'agent_server.py'),
  agentHealthUrl: process.env.AGENT_HEALTH_URL || 'http://127.0.0.1:5111/health',
};
