const { Client } = require('ssh2');
const iconv = require('iconv-lite');

module.exports = (config) => async (req, res) => {
  if (!req.app.locals.connectionDetails) {
    console.log('[Request Interception] Connection details not provided.');
    return res.status(400).send('Connection details not provided.');
  }

  const { command } = req.body;
  console.log(`[New Request] Command received: ${command}`);
  
  const conn = new Client();
  console.log('[Connection Phase] Initializing SSH connection...');

  try {
    const output = await new Promise((resolve, reject) => {
      conn.on('error', (err) => {
        console.error('[Connection Error] SSH connection failed:', err);
        reject(err);
      });

      conn.on('ready', () => {
        console.log('[Connection Established] ✓ SSH tunnel is now active.');
        
        const fullCommand = config.env.replace('__COMMAND__', command);
        console.log(`[Executing Command] $\x1b[34m${fullCommand}\x1b[0m`);

        conn.exec(fullCommand, (err, stream) => {
          if (err) {
            console.error('[Command Error] Execution failed:', err);
            return reject(err);
          }

          let output = '';
          console.log('[Output Start] --- Real-time Output ---');

          stream.on('data', (data) => {
            const decoded = iconv.decode(data, 'utf-8');
            output += decoded;
            process.stdout.write(`\x1b[90m${decoded}\x1b[0m`);
          });

          if (config.hasStderr) {
            stream.stderr.on('data', (errData) => {
              const errDecoded = iconv.decode(errData, 'utf-8');
              output += errDecoded;
              process.stdout.write(`\x1b[31m[ERROR] ${errDecoded}\x1b[0m`);
            });
          }

          stream.on('close', (code, signal) => {
            console.log('\n[Output End] --- Command Execution Completed ---');
            console.log(`[Status] Exit Code: ${code}, Signal: ${signal || 'None'}`);
            conn.end();
            resolve(output || 'No output available');
          });
        });
      }).connect(req.app.locals.connectionDetails);
    });

    console.log('[Completed] Request processed successfully.');
    res.json({ output });
  } catch (err) {
    console.error('\x1b[31m[Critical Error]\x1b[0m', err);
    res.status(500).send('Error executing command');
  }
};
