/**
 * File and browser routes: upload, download, delete, file-browser, browse-remote-files,
 * read-remote-file, check-folder, server-files, server-folders, picker
 */
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const JSZip = require('jszip');

function registerFileRoutes(app, appConfig, upload, checkConnection, sshHelpers) {
  app.get('/:tool/file-browser', async (req, res) => {
    try {
      const tool = req.params.tool;
      let dir = req.query.dir || '/';
      dir = dir.replace(/\/+/g, '/');
      if (!dir.startsWith('/')) dir = '/' + dir;
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(401).send('Not connected to remote server');
      const filelist = await sshHelpers.getRemoteFileList(dir, {
        host: connectionDetails.host,
        port: connectionDetails.port,
        username: connectionDetails.username,
        password: connectionDetails.password
      });
      res.render('file-browser', { currentDir: dir, filelist, tool, picker: false });
    } catch (error) {
      console.error('Error in file browser:', error);
      res.status(500).send('Error accessing file browser: ' + error.message);
    }
  });

  app.post('/upload-files', upload.array('files'), async (req, res) => {
    try {
      const files = req.files;
      const currentDir = req.body.currentDir;
      if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
      if (!currentDir) return res.status(400).json({ error: 'Current directory not specified' });
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(401).json({ error: 'Not connected to remote server' });
      const sshConfig = { host: connectionDetails.host, port: connectionDetails.port, username: connectionDetails.username, password: connectionDetails.password };
      const conn = new Client();
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
          let hasError = false;
          const uploadNext = (index) => {
            if (index >= files.length) {
              files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
              conn.end();
              if (!hasError) res.end(JSON.stringify({ success: true }));
              return;
            }
            const file = files[index];
            const originalName = path.basename(file.originalname);
            const remotePath = path.posix.join(currentDir, originalName);
            sftp.fastPut(file.path, remotePath, (err) => {
              if (err) {
                hasError = true;
                if (!res.headersSent) res.status(500).json({ error: `Failed to upload ${originalName}: ${err.message}` });
                return;
              }
              res.write(JSON.stringify({ progress: Math.round(((index + 1) / files.length) * 100) }) + '\n');
              uploadNext(index + 1);
            });
          };
          uploadNext(0);
        });
      }).on('error', (err) => {
        if (files) files.forEach(f => { try { fs.unlinkSync(f.path); } catch (_) {} });
        if (!res.headersSent) res.status(500).json({ error: err.message });
      }).connect(sshConfig);
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ error: error.message });
    }
  });

  app.post('/download-files', async (req, res) => {
    try {
      const { files, currentDir } = req.body;
      if (!files || files.length === 0) return res.status(400).json({ error: 'No files selected for download' });
      if (!currentDir) return res.status(400).json({ error: 'Current directory not specified' });
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(401).json({ error: 'Not connected to remote server' });
      const sshConfig = { host: connectionDetails.host, port: connectionDetails.port, username: connectionDetails.username, password: connectionDetails.password };
      const conn = new Client();
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
          const zip = new JSZip();
          let hasError = false;
          const processNext = (index) => {
            if (index >= files.length) {
              zip.generateAsync({ type: 'nodebuffer' })
                .then(content => {
                  if (!hasError) {
                    res.setHeader('Content-Type', 'application/zip');
                    res.setHeader('Content-Disposition', 'attachment; filename=selected_files.zip');
                    res.send(content);
                  }
                  conn.end();
                })
                .catch(e => { if (!hasError) { hasError = true; res.status(500).json({ error: 'Failed to create zip: ' + e.message }); } conn.end(); });
              return;
            }
            const filename = path.basename(files[index]);
            const filePath = path.posix.join(currentDir, filename);
            sftp.readFile(filePath, (err, data) => {
              if (err) { if (!hasError) { hasError = true; res.status(500).json({ error: `Failed to read ${filename}` }); } }
              else zip.file(filename, data);
              processNext(index + 1);
            });
          };
          processNext(0);
        });
      }).on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); }).connect(sshConfig);
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ error: error.message });
    }
  });

  app.post('/delete-files', async (req, res) => {
    try {
      const { files, currentDir } = req.body;
      if (!files || files.length === 0) return res.status(400).json({ error: 'No files selected for deletion' });
      if (!currentDir) return res.status(400).json({ error: 'Current directory not specified' });
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(401).json({ error: 'Not connected to remote server' });
      const sshConfig = { host: connectionDetails.host, port: connectionDetails.port, username: connectionDetails.username, password: connectionDetails.password };
      const conn = new Client();
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Transfer-Encoding', 'chunked');
          res.flushHeaders();
          let hasError = false;
          const deleteNext = (index) => {
            if (index >= files.length) {
              conn.end();
              if (!hasError) res.write(JSON.stringify({ success: true }) + '\n');
              res.end();
              return;
            }
            const filename = path.basename(files[index]);
            const filePath = path.posix.join(currentDir, filename);
            sftp.unlink(filePath, (err) => {
              if (err) { if (!hasError) { hasError = true; res.write(JSON.stringify({ error: `Failed to delete ${filename}` }) + '\n'); } }
              res.write(JSON.stringify({ progress: Math.round(((index + 1) / files.length) * 100) }) + '\n');
              deleteNext(index + 1);
            });
          };
          deleteNext(0);
        });
      }).on('error', (err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); }).connect(sshConfig);
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ error: error.message });
    }
  });

  app.get('/check-folder', async (req, res) => {
    try {
      let dir = req.query.dir || '/';
      dir = dir.replace(/\/+/g, '/');
      if (!dir.startsWith('/')) dir = '/' + dir;
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(401).json({ error: 'Not connected to remote server' });
      const conn = new Client();
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return res.status(500).json({ error: err.message }); }
          sftp.stat(dir, (err, stats) => {
            conn.end();
            if (err) return res.json({ exists: false });
            res.json({ exists: stats.isDirectory() });
          });
        });
      }).on('error', (err) => res.status(500).json({ error: err.message })).connect({
        host: connectionDetails.host, port: connectionDetails.port, username: connectionDetails.username, password: connectionDetails.password
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/browse-remote-files', checkConnection, async (req, res) => {
    try {
      let dir = req.query.dir || '/';
      dir = dir.replace(/\/+/g, '/');
      if (!dir.startsWith('/')) dir = '/' + dir;
      const cd = req.app.locals.connectionDetails;
      const fileList = await sshHelpers.getRemoteFileList(dir, { host: cd.host, port: cd.port, username: cd.username, password: cd.password });
      res.json({ currentDir: dir, files: fileList });
    } catch (error) {
      res.status(500).json({ error: 'Failed to browse remote directory', details: error.message });
    }
  });

  app.get('/read-remote-file', checkConnection, async (req, res) => {
    try {
      const filePath = req.query.path;
      if (!filePath) return res.status(400).json({ error: 'File path is required' });
      const cd = req.app.locals.connectionDetails;
      const fileContent = await sshHelpers.readRemoteFileContent(filePath, { host: cd.host, port: cd.port, username: cd.username, password: cd.password });
      res.json({ content: fileContent.content, size: fileContent.size });
    } catch (error) {
      res.status(500).json({ error: 'Failed to read remote file', details: error.message });
    }
  });

  app.get('/api/server-files', checkConnection, async (req, res) => {
    try {
      const dir = req.query.dir || '/';
      const cd = req.app.locals.connectionDetails;
      const fileList = await sshHelpers.getRemoteFileList(dir, { host: cd.host, port: cd.port, username: cd.username, password: cd.password });
      res.json(fileList.filter(item => !item.isDirectory));
    } catch (error) {
      res.status(500).json({ error: 'Failed to load server files' });
    }
  });

  app.get('/api/server-folders', checkConnection, async (req, res) => {
    try {
      const dir = req.query.dir || '/';
      const cd = req.app.locals.connectionDetails;
      const fileList = await sshHelpers.getRemoteFileList(dir, { host: cd.host, port: cd.port, username: cd.username, password: cd.password });
      res.json(fileList.filter(item => item.isDirectory));
    } catch (error) {
      res.status(500).json({ error: 'Failed to load server folders' });
    }
  });

  app.get('/browse-files', checkConnection, (req, res) => {
    res.render('file-browser', { type: req.query.type || 'input', currentDir: '/', filelist: [], tool: 'browse-files', picker: false });
  });

  app.get('/picker/file-browser', checkConnection, async (req, res) => {
    try {
      let dir = req.query.dir || '/';
      dir = dir.replace(/\/+/g, '/');
      if (!dir.startsWith('/')) dir = '/' + dir;
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(401).send('Not connected to remote server');
      const filelist = await sshHelpers.getRemoteFileList(dir, { host: connectionDetails.host, port: connectionDetails.port, username: connectionDetails.username, password: connectionDetails.password });
      res.render('file-picker', { type: req.query.type || 'input', currentDir: dir, filelist, tool: 'picker', picker: true });
    } catch (error) {
      res.status(500).send('Error accessing file browser: ' + error.message);
    }
  });

  app.get('/picker', checkConnection, (req, res) => res.redirect('/picker/file-picker?dir=/&type=input&picker=1'));

  app.get('/picker/file-picker', checkConnection, async (req, res) => {
    try {
      let dir = req.query.dir || '/';
      dir = dir.replace(/\/+/g, '/');
      if (!dir.startsWith('/')) dir = '/' + dir;
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(401).send('Not connected to remote server');
      const filelist = await sshHelpers.getRemoteFileList(dir, { host: connectionDetails.host, port: connectionDetails.port, username: connectionDetails.username, password: connectionDetails.password });
      res.render('file-picker', { type: req.query.type || 'input', currentDir: dir, filelist, tool: 'picker', picker: true });
    } catch (error) {
      res.status(500).send('Error accessing file picker: ' + error.message);
    }
  });
}

module.exports = { registerFileRoutes };
