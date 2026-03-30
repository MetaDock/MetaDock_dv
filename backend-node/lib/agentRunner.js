/**
 * Start Python agent process and poll health. Sets app.locals.isAgentReady.
 */
const { spawn } = require('child_process');
const axios = require('axios');

function startAgent(app, appConfig) {
  app.locals.isAgentReady = false;
  const agentProcess = spawn('python', [appConfig.agentScript]);

  agentProcess.stdout.on('data', (data) => console.log(`Agent-stdout: ${data}`));
  agentProcess.stderr.on('data', (data) => console.error(`Agent-stderr: ${data}`));
  agentProcess.on('close', (code) => {
    console.log(`Agent process exited with code ${code}`);
    app.locals.isAgentReady = false;
  });

  const healthUrl = appConfig.agentHealthUrl || 'http://127.0.0.1:5111/health';
  const checkAgentHealth = async () => {
    try {
      const response = await axios.get(healthUrl);
      if (response.status === 200 && response.data.status === 'ok') {
        if (!app.locals.isAgentReady) {
          console.log('✅ Bioinfo Agent is ready.');
          app.locals.isAgentReady = true;
        }
      } else {
        setTimeout(checkAgentHealth, 2000);
      }
    } catch (err) {
      if (app.locals.isAgentReady) {
        console.log('Agent connection lost. Re-checking...');
        app.locals.isAgentReady = false;
      }
      setTimeout(checkAgentHealth, 2000);
    }
  };
  setTimeout(checkAgentHealth, 3000);
}

module.exports = { startAgent };
