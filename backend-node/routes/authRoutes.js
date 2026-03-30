/**
 * Auth/connection routes: /connect, /check-connection, /logout
 */
const { Client } = require('ssh2');

function registerAuthRoutes(app, upload) {
  app.post('/connect', upload.none(), async (req, res) => {
    const { host, port, username, password } = req.body;
    if (!host || !username || !password) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'Please provide host, username, and password'
      });
    }
    try {
      const conn = new Client();
      await new Promise((resolve, reject) => {
        conn.on('ready', () => {
          req.app.locals.connectionDetails = {
            host,
            port: parseInt(port) || 22,
            username,
            password
          };
          conn.end();
          resolve();
        });
        conn.on('error', reject);
        conn.connect({
          host,
          port: parseInt(port) || 22,
          username,
          password,
          readyTimeout: 10000,
          tryKeyboard: true
        });
      });
      res.json({ success: true, message: 'Connection successful' });
    } catch (error) {
      console.error('Connection attempt failed:', error);
      res.status(500).json({ error: 'Connection failed', details: error.message });
    }
  });

  app.get('/check-connection', async (req, res) => {
    if (!req.app.locals.connectionDetails) {
      return res.json({ connected: false, error: 'No connection details available' });
    }
    try {
      const conn = new Client();
      await new Promise((resolve, reject) => {
        conn.on('ready', () => { conn.end(); resolve(); });
        conn.on('error', reject);
        conn.connect(req.app.locals.connectionDetails);
      });
      res.json({ connected: true });
    } catch (err) {
      res.json({ connected: false, error: err.message });
    }
  });

  app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
      if (err) console.error('Error destroying session:', err);
      req.app.locals.connectionDetails = null;
      res.redirect('/login');
    });
  });
}

module.exports = { registerAuthRoutes };
