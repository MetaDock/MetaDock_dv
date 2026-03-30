/**
 * Conda API routes: /api/conda-environments, /api/conda-test, /api/conda-terminal
 */
const { Client } = require('ssh2');

function registerCondaRoutes(app, checkConnectionAPI) {
  app.get('/api/conda-environments', checkConnectionAPI, async (req, res) => {
    try {
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(400).json({ error: 'No connection details available' });
      const conn = new Client();
      conn.on('ready', () => {
        const commands = [
          'conda env list',
          '/opt/miniconda3/bin/conda env list',
          '/opt/conda/bin/conda env list',
          'source ~/.bashrc && conda env list',
          'eval "$(conda shell.bash hook)" && conda env list'
        ];
        let commandIndex = 0;
        function tryNext() {
          if (commandIndex >= commands.length) {
            return res.status(500).json({ error: 'All conda commands failed' });
          }
          const cmd = commands[commandIndex++];
          conn.exec(cmd, (err, stream) => {
            if (err) return tryNext();
            let output = '', errorOutput = '';
            stream.on('close', (code) => {
              if (code !== 0) return tryNext();
              const environments = [];
              output.split('\n').forEach(line => {
                const t = line.trim();
                if (t && !t.startsWith('#')) {
                  const parts = t.split(/\s+/);
                  if (parts[0]) environments.push({ name: parts[0], path: parts[parts.length - 1] || '', active: t.includes('*') });
                }
              });
              conn.end();
              res.json({ success: true, environments, rawOutput: output, commandUsed: cmd });
            });
            stream.on('data', (d) => { output += d.toString(); });
            stream.stderr.on('data', (d) => { errorOutput += d.toString(); });
          });
        }
        tryNext();
      });
      conn.on('error', (err) => res.status(500).json({ error: 'SSH connection failed', details: err.message }));
      conn.connect(connectionDetails);
    } catch (error) {
      res.status(500).json({ error: 'Failed to list conda environments' });
    }
  });

  app.get('/api/conda-test', checkConnectionAPI, async (req, res) => {
    try {
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(400).json({ error: 'No connection details available' });
      const conn = new Client();
      conn.on('ready', () => {
        conn.exec('which conda || echo "conda not found"', (err, stream) => {
          if (err) { conn.end(); return res.status(500).json({ error: 'Failed to test conda' }); }
          let output = '';
          stream.on('close', () => {
            conn.end();
            const condaPath = output.trim();
            const hasData = condaPath && !condaPath.includes('conda not found');
            res.json({ success: true, condaAvailable: hasData, condaPath: hasData ? condaPath : null, message: hasData ? 'Conda is available' : 'Conda not found in PATH' });
          });
          stream.on('data', (d) => { output += d.toString(); });
        });
      });
      conn.on('error', (err) => res.status(500).json({ error: 'SSH connection failed', details: err.message }));
      conn.connect(connectionDetails);
    } catch (error) {
      res.status(500).json({ error: 'Failed to test conda availability' });
    }
  });

  app.get('/api/conda-terminal', checkConnectionAPI, async (req, res) => {
    try {
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(400).json({ error: 'No connection details available' });
      const conn = new Client();
      const commands = [
        'echo "=== Checking conda ==="',
        'which conda 2>/dev/null || echo "conda not in PATH"',
        'conda env list 2>&1 || echo "conda env list failed"',
        'echo "=== Check completed ==="'
      ];
      conn.on('ready', () => {
        conn.exec(commands.join(' && '), (err, stream) => {
          if (err) { conn.end(); return res.status(500).json({ error: 'Failed to execute' }); }
          let output = '', errorOutput = '';
          stream.on('close', (code) => {
            conn.end();
            res.json({ success: true, output, errorOutput, exitCode: code, timestamp: new Date().toISOString() });
          });
          stream.on('data', (d) => { output += d.toString(); });
          stream.stderr.on('data', (d) => { errorOutput += d.toString(); });
        });
      });
      conn.on('error', (err) => res.status(500).json({ error: 'SSH connection failed', details: err.message }));
      conn.connect(connectionDetails);
    } catch (error) {
      res.status(500).json({ error: 'Failed to run conda terminal check' });
    }
  });
}

module.exports = { registerCondaRoutes };
