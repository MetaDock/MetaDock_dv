/**
 * Visualization API: /api/viz/codegen, /api/viz/run
 */
const axios = require('axios');
const sshHelpers = require('../lib/sshHelpers');

const AGENT_BASE = 'http://127.0.0.1:5111';

function registerVizRoutes(app, appConfig, checkConnectionAPI) {
  app.post('/api/viz/codegen', async (req, res) => {
    try {
      let payload = { ...req.body };
      if (payload.file_path && req.app.locals.connectionDetails) {
        try {
          const { headContent, columns } = await sshHelpers.getRemoteFileHead(
            payload.file_path, req.app.locals.connectionDetails, 5
          );
          payload.detected_columns = columns;
          payload.file_head = headContent;
        } catch (err) {
          console.warn('Failed to read remote file head:', err.message);
        }
      }
      const response = await axios.post(`${AGENT_BASE}/viz/codegen`, payload);
      res.json(response.data);
    } catch (error) {
      if (error.response) return res.status(error.response.status || 500).json(error.response.data);
      res.status(500).json({ error: 'Failed to generate visualization code' });
    }
  });

  app.post('/api/viz/run', checkConnectionAPI, async (req, res) => {
    try {
      const { code, format = 'png' } = req.body;
      if (!code) return res.status(400).json({ error: 'Code is required' });
      const connectionDetails = req.app.locals.connectionDetails;
      const remoteTmp = appConfig.vizRemoteTmp;
      const ts = Date.now();
      const scriptPath = `${remoteTmp}/viz_${ts}.py`;
      let imagePath = `${remoteTmp}/viz_${ts}.${format}`;

      await sshHelpers.ensureRemoteDir(remoteTmp, connectionDetails);

      let finalCode = code.replace(/__OUTPUT_PATH__/g, imagePath);
      finalCode = `OUTPUT_PATH = r"${imagePath}"\n` + finalCode.replace(/OUTPUT_PATH\s*=\s*['"][^'"]+['"]/g, '');
      if (!finalCode.includes('matplotlib.use("Agg")')) {
        finalCode = `import matplotlib\nmatplotlib.use("Agg")\n` + finalCode;
      }
      const scriptContent = `
import os, pathlib
${finalCode}
if not os.path.isfile(OUTPUT_PATH):
    raise SystemExit(f"Output file not found: {OUTPUT_PATH}")
print(f"[VIZ_OUTPUT]{OUTPUT_PATH}")
`;
      await sshHelpers.uploadTextFile(scriptPath, scriptContent, connectionDetails);
      const vizPython = process.env.VIZ_PYTHON || 'python3';
      await sshHelpers.executeRemoteCommand(`cd ${remoteTmp} && ${vizPython} ${scriptPath}`, connectionDetails);

      let exists = await sshHelpers.remoteFileExists(imagePath, connectionDetails);
      if (!exists && format === 'png') {
        const fallback = await sshHelpers.findRecentPng(remoteTmp, ts, connectionDetails);
        if (fallback) {
          imagePath = fallback.fullPath;
          exists = true;
        }
      }
      if (!exists) {
        return res.status(500).json({ error: `Output file not found at ${imagePath}` });
      }

      if (format === 'html') {
        const htmlBuffer = await sshHelpers.downloadRemoteFile(imagePath, connectionDetails);
        return res.json({
          success: true,
          htmlContent: htmlBuffer.toString('utf-8'),
          imagePath, format
        });
      }
      const imageBuffer = await sshHelpers.downloadRemoteFile(imagePath, connectionDetails);
      res.json({
        success: true,
        imageBase64: imageBuffer.toString('base64'),
        imagePath, format
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to run visualization', details: error.message });
    }
  });
}

module.exports = { registerVizRoutes };
