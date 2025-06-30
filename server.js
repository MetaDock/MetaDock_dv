const express = require('express');
const { exec } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs').promises;
const multer = require('multer');
const toolsConfig = require('./config/tools');
const visualizationConfig = require('./config/visualization');
const commandHandler = require('./handlers/commandHandler');
const iconv = require('iconv-lite');
const path = require('path');
const adminRoutes = require('./admin/routes/adminRoutes');
const session = require('express-session');
const { promisify } = require('util');
const JSZip = require('jszip');
const axios = require('axios');
const { spawn } = require('child_process');

const app = express();

// Agent state
app.locals.isAgentReady = false;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const tempDir = path.join(__dirname, 'temp_uploads');
        // Create temp directory if it doesn't exist
        if (!require('fs').existsSync(tempDir)) {
            require('fs').mkdirSync(tempDir, { recursive: true });
        }
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Basic middleware configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Start Python Agent
const agentProcess = spawn('python', ['agent/agent_server.py']);

agentProcess.stdout.on('data', (data) => {
  console.log(`Agent-stdout: ${data}`);
});

agentProcess.stderr.on('data', (data) => {
  console.error(`Agent-stderr: ${data}`);
});

agentProcess.on('close', (code) => {
  console.log(`Agent process exited with code ${code}`);
  app.locals.isAgentReady = false; // Mark agent as not ready
});

// Health check for the agent
const checkAgentHealth = async () => {
  try {
    const response = await axios.get('http://127.0.0.1:5111/health');
    if (response.status === 200 && response.data.status === 'ok') {
      if (!app.locals.isAgentReady) {
        console.log('✅ Bioinfo Agent is ready.');
        app.locals.isAgentReady = true;
      }
    } else {
      setTimeout(checkAgentHealth, 2000); // Check again in 2 seconds
    }
  } catch (error) {
    if (app.locals.isAgentReady) {
        console.log('Agent connection lost. Re-checking...');
        app.locals.isAgentReady = false;
    }
    setTimeout(checkAgentHealth, 2000); // Check again in 2 seconds
  }
};

setTimeout(checkAgentHealth, 3000); // Start polling after a short delay

// Session configuration
app.use(session({
  secret: 'your-secret-key', // TODO: Replace with environment variable
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Set the view engine to EJS
app.set('view engine', 'ejs');
app.set('views', [
  path.join(__dirname, 'admin', 'views'),
  path.join(__dirname, 'public', 'views')
]);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Add middleware to check connection status
const checkConnection = (req, res, next) => {
  if (!req.app.locals.connectionDetails) {
    return res.redirect('/login');
  }
  next();
};

// Add middleware to pass connectionDetails to all routes
app.use((req, res, next) => {
  res.locals.connectionDetails = req.app.locals.connectionDetails;
  next();
});

// Basic routes
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  // If already admin, redirect to installer index
  if (req.session.isAdmin) {
    return res.redirect('/admin');
  }
  res.render('login');
});

// Admin routes - must be after basic routes
app.use('/admin', adminRoutes);

// Protected routes - regular user dashboard
app.get('/dashboard', checkConnection, (req, res) => {
  // If admin, redirect to installer index
  if (req.session.isAdmin) {
    return res.redirect('/admin');
  }
  // Otherwise show regular user dashboard
  res.render('dashboard', { toolsConfig });
});

// Dynamic tool routes - must be before the :tool/file-browser route
Object.values(toolsConfig).forEach(tool => {
  // Add case-insensitive routes
  app.get(`/${tool.route.toLowerCase()}`, checkConnection, (req, res) => {
    res.render(tool.html, {
        title: tool.title,
        toolName: tool.toolName,
        commandRoute: tool.commandRoute
      });
    });

    app.post(tool.commandRoute, commandHandler(tool));
  
    app.get(`/get_${path.basename(tool.usagePath, '_usage.json')}_usage`, (req, res) => {
      res.sendFile(path.join(__dirname, tool.usagePath));
    });
  
    app.get(`/get_${path.basename(tool.paraPath, '_para.json')}_para`, (req, res) => {
      res.sendFile(path.join(__dirname, tool.paraPath));
    });
  
    app.get(tool.selectionRoute, async (req, res) => {
      const { files: selectedFiles = '' } = req.query;
      try {
        const data = await fs.readFile(path.join(__dirname, 'public', tool.html), 'utf8');
        const updatedPage = data.replace(
          '<input type="text" id="file-input" placeholder="Selected files">',
          `<input type="text" id="file-input" value="${selectedFiles}" placeholder="Selected files">`
        );
        res.type('html').send(updatedPage);
      } catch (err) {
        console.error(`Error loading ${tool.html}:`, err);
        res.status(500).send('Error loading the page');
      }
    });
  });

// Dynamic visualization routes
Object.values(visualizationConfig).forEach(visualization => {
  app.get(`/${visualization.route.toLowerCase()}`, checkConnection, (req, res) => {
    res.render(visualization.html, {
      title: visualization.title,
      toolName: visualization.toolName,
      icon: visualization.icon,
      visualizationPath: visualization.visualizationPath
    });
  });
});

// SSH connection configuration
const sshConfig = {
    host: process.env.SSH_HOST || 'localhost',
    port: process.env.SSH_PORT || 22,
    username: process.env.SSH_USER || 'root',
    password: process.env.SSH_PASSWORD || '',
    privateKey: process.env.SSH_KEY ? require('fs').readFileSync(process.env.SSH_KEY) : undefined
};

// Helper function to get file list from remote system
async function getRemoteFileList(dir, sshConfig) {
    return new Promise((resolve, reject) => {
        const conn = new Client();
        const fileList = [];

        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return reject(err);
                }

                sftp.readdir(dir, (err, list) => {
                    if (err) {
                        conn.end();
                        return reject(err);
                    }

                    // Process each file
                    const processFile = (index) => {
                        if (index >= list.length) {
                            conn.end();
                            // Sort directories first, then files alphabetically
                            return resolve(fileList.sort((a, b) => {
                                if (a.isDirectory && !b.isDirectory) return -1;
                                if (!a.isDirectory && b.isDirectory) return 1;
                                return a.filename.localeCompare(b.filename);
                            }));
                        }

                        const file = list[index];
                        // Skip system files and hidden files
                        if (file.filename.startsWith('.') || 
                            file.filename === 'pagefile.sys' || 
                            file.filename === 'hiberfil.sys' || 
                            file.filename === 'swapfile.sys') {
                            return processFile(index + 1);
                        }

                        const isDirectory = file.attrs.isDirectory();
                        const filePath = path.posix.join(dir, file.filename);
                        
                        fileList.push({
                            filename: file.filename, // Only the filename
                            size: formatFileSize(file.attrs.size),
                            date: new Date(file.attrs.mtime * 1000).toLocaleString(),
                            permissions: getFilePermissions(file.attrs.mode),
                            isDirectory: isDirectory,
                            fullPath: filePath, // Add fullPath for navigation
                            buttons: isDirectory 
                                ? `<button onclick="navigateToFolder('${filePath}')" class="folder-btn">Open</button>`
                                : `<button onclick="selectFile('${file.filename}')" class="file-btn">Select</button>`
                        });

                        processFile(index + 1);
                    };

                    processFile(0);
                });
            });
        }).on('error', (err) => {
            reject(err);
        }).connect(sshConfig);
    });
}

// Modify the file browser route to handle directories differently
app.get('/:tool/file-browser', async (req, res) => {
    try {
        const tool = req.params.tool;
        let dir = req.query.dir || '/';
        
        // Normalize the path
        dir = dir.replace(/\/+/g, '/'); // Replace multiple slashes with single slash
        if (!dir.startsWith('/')) {
            dir = '/' + dir;
        }
        
        // Get connection details from session
        const connectionDetails = req.app.locals.connectionDetails;
        if (!connectionDetails) {
            return res.status(401).send('Not connected to remote server');
        }

        // Create SSH config from connection details
        const sshConfig = {
            host: connectionDetails.host,
            port: connectionDetails.port,
            username: connectionDetails.username,
            password: connectionDetails.password
        };
        
        // Get file list from remote system
        const filelist = await getRemoteFileList(dir, sshConfig);
        
        res.render('file-browser', {
            currentDir: dir,
            filelist: filelist,
            tool: tool
        });
    } catch (error) {
        console.error('Error in file browser:', error);
        res.status(500).send('Error accessing file browser: ' + error.message);
    }
});

// Modify file upload handler to use session connection details
app.post('/upload-files', upload.array('files'), async (req, res) => {
    try {
        const files = req.files;
        const currentDir = req.body.currentDir;
        
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }
        
        if (!currentDir) {
            return res.status(400).json({ error: 'Current directory not specified' });
        }

        const connectionDetails = req.app.locals.connectionDetails;
        if (!connectionDetails) {
            return res.status(401).json({ error: 'Not connected to remote server' });
        }

        const sshConfig = {
            host: connectionDetails.host,
            port: connectionDetails.port,
            username: connectionDetails.username,
            password: connectionDetails.password
        };
        
        const conn = new Client();
        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return res.status(500).json({ error: err.message });
                }

                let uploaded = 0;
                const total = files.length;
                let hasError = false;

                const uploadNext = (index) => {
                    if (index >= files.length) {
                        // Clean up temporary files
                        files.forEach(file => {
                            try {
                                require('fs').unlinkSync(file.path);
                            } catch (err) {
                                console.error(`Error deleting temporary file ${file.path}:`, err);
                            }
                        });
                        conn.end();
                        if (!hasError) {
                            res.end(JSON.stringify({ success: true }));
                        }
                        return;
                    }

                    const file = files[index];
                    // Get only the original filename without any path
                    const originalName = path.basename(file.originalname);
                    // Create the remote path using only the current directory and original filename
                    const remotePath = path.posix.join(currentDir, originalName);

                    sftp.fastPut(file.path, remotePath, (err) => {
                        if (err) {
                            console.error(`Error uploading ${originalName}:`, err);
                            hasError = true;
                            if (!res.headersSent) {
                                res.status(500).json({ error: `Failed to upload ${originalName}: ${err.message}` });
                            }
                            return;
                        }
                        uploaded++;
                        if (!hasError) {
                            res.write(JSON.stringify({ progress: Math.round((uploaded / total) * 100) }) + '\n');
                        }
                        uploadNext(index + 1);
                    });
                };

                uploadNext(0);
            });
        }).on('error', (err) => {
            // Clean up temporary files on error
            if (files) {
                files.forEach(file => {
                    try {
                        require('fs').unlinkSync(file.path);
                    } catch (err) {
                        console.error(`Error deleting temporary file ${file.path}:`, err);
                    }
                });
            }
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            }
        }).connect(sshConfig);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Modify file download handler to use session connection details
app.post('/download-files', async (req, res) => {
    try {
        const { files, currentDir } = req.body;
        
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files selected for download' });
        }

        if (!currentDir) {
            return res.status(400).json({ error: 'Current directory not specified' });
        }
        
        const connectionDetails = req.app.locals.connectionDetails;
        if (!connectionDetails) {
            return res.status(401).json({ error: 'Not connected to remote server' });
        }

        const sshConfig = {
            host: connectionDetails.host,
            port: connectionDetails.port,
            username: connectionDetails.username,
            password: connectionDetails.password
        };
        
        const conn = new Client();
        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return res.status(500).json({ error: err.message });
                }

                // Create a zip file
                const zip = new JSZip();
                let hasError = false;

                const processNext = (index) => {
                    if (index >= files.length) {
                        // Generate zip file
                        zip.generateAsync({ type: 'nodebuffer' })
                            .then(content => {
                                if (!hasError) {
                                    res.setHeader('Content-Type', 'application/zip');
                                    res.setHeader('Content-Disposition', 'attachment; filename=selected_files.zip');
                                    res.send(content);
                                }
                                conn.end();
                            })
                            .catch(err => {
                                if (!hasError) {
                                    hasError = true;
                                    res.status(500).json({ error: 'Failed to create zip file: ' + err.message });
                                }
                                conn.end();
                            });
                        return;
                    }

                    const filename = path.basename(files[index]);
                    const filePath = path.posix.join(currentDir, filename);

                    sftp.readFile(filePath, (err, data) => {
                        if (err) {
                            console.error(`Error reading ${filename}:`, err);
                            if (!hasError) {
                                hasError = true;
                                res.status(500).json({ error: `Failed to read ${filename}: ${err.message}` });
                            }
                        } else {
                            zip.file(filename, data);
                        }
                        processNext(index + 1);
                    });
                };

                processNext(0);
            });
        }).on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            }
        }).connect(sshConfig);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Modify file delete handler to use session connection details
app.post('/delete-files', async (req, res) => {
    try {
        const { files, currentDir } = req.body;
        
        if (!files || files.length === 0) {
            return res.status(400).json({ error: 'No files selected for deletion' });
        }

        if (!currentDir) {
            return res.status(400).json({ error: 'Current directory not specified' });
        }
        
        const connectionDetails = req.app.locals.connectionDetails;
        if (!connectionDetails) {
            return res.status(401).json({ error: 'Not connected to remote server' });
        }

        const sshConfig = {
            host: connectionDetails.host,
            port: connectionDetails.port,
            username: connectionDetails.username,
            password: connectionDetails.password
        };
        
        const conn = new Client();
        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return res.status(500).json({ error: err.message });
                }

                // Set up streaming response
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Transfer-Encoding', 'chunked');
                res.flushHeaders();

                let deleted = 0;
                const total = files.length;
                let hasError = false;

                const deleteNext = (index) => {
                    if (index >= files.length) {
                        conn.end();
                        if (!hasError) {
                            res.write(JSON.stringify({ success: true }) + '\n');
                        }
                        res.end();
                        return;
                    }

                    // Use only the filename and current directory
                    const filename = path.basename(files[index]);
                    const filePath = path.posix.join(currentDir, filename);

                    sftp.unlink(filePath, (err) => {
                        if (err) {
                            console.error(`Error deleting ${filename}:`, err);
                            if (!hasError) {
                                hasError = true;
                                res.write(JSON.stringify({ error: `Failed to delete ${filename}: ${err.message}` }) + '\n');
                            }
                        }
                        deleted++;
                        if (!hasError) {
                            res.write(JSON.stringify({ progress: Math.round((deleted / total) * 100) }) + '\n');
                        }
                        deleteNext(index + 1);
                    });
                };

                deleteNext(0);
            });
        }).on('error', (err) => {
            if (!res.headersSent) {
                res.status(500).json({ error: err.message });
            }
        }).connect(sshConfig);
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        }
    }
});

// Connection related routes
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
        console.log('SSH connection established');
        req.app.locals.connectionDetails = {
          host,
          port: parseInt(port) || 22,
          username,
          password
        };
        conn.end();
        resolve();
      });

      conn.on('error', (err) => {
        console.error('SSH connection failed:', err);
        reject(err);
      });

      conn.connect({
        host,
        port: parseInt(port) || 22,
        username,
        password,
        readyTimeout: 10000,
        tryKeyboard: true
      });
    });

    res.json({ 
      success: true, 
      message: 'Connection successful' 
    });
  } catch (error) {
    console.error('Connection attempt failed:', error);
    res.status(500).json({ 
      error: 'Connection failed',
      details: error.message
    });
  }
});

// Check connection status
app.get('/check-connection', async (req, res) => {
  if (!req.app.locals.connectionDetails) {
    return res.json({ 
      connected: false, 
      error: 'No connection details available' 
    });
  }

  try {
    const conn = new Client();
    await new Promise((resolve, reject) => {
      conn.on('ready', () => {
        conn.end();
        resolve();
      });

      conn.on('error', (err) => {
        reject(err);
      });

      conn.connect(req.app.locals.connectionDetails);
    });

    res.json({ connected: true });
  } catch (err) {
    console.error('Connection check failed:', err);
    res.json({ 
      connected: false, 
      error: err.message
    });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  // Clear all session data
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    // Clear connection details
    req.app.locals.connectionDetails = null;
    res.redirect('/login');
  });
});

// Tool search route
app.get('/search-tools', (req, res) => {
  const query = req.query.query?.toLowerCase() || '';
  
  if (!query) {
    return res.json([]);
  }

  const matchingTools = Object.values(toolsConfig).filter(tool => {
    const toolName = tool.toolName.toLowerCase();
    const description = (tool.description || '').toLowerCase();
    const route = tool.route.toLowerCase();
    
    return toolName.includes(query) || 
           description.includes(query) || 
           route.includes(query);
  });

  res.json(matchingTools);
});

// Add check-folder route
app.get('/check-folder', async (req, res) => {
    try {
        let dir = req.query.dir;
        
        // Normalize the path
        dir = dir.replace(/\/+/g, '/'); // Replace multiple slashes with single slash
        if (!dir.startsWith('/')) {
            dir = '/' + dir;
        }
        
        const connectionDetails = req.app.locals.connectionDetails;
        if (!connectionDetails) {
            return res.status(401).json({ error: 'Not connected to remote server' });
        }

        const sshConfig = {
            host: connectionDetails.host,
            port: connectionDetails.port,
            username: connectionDetails.username,
            password: connectionDetails.password
        };

        const conn = new Client();
        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    conn.end();
                    return res.status(500).json({ error: err.message });
                }

                sftp.stat(dir, (err, stats) => {
                    conn.end();
                    if (err) {
                        return res.json({ exists: false });
                    }
                    res.json({ exists: stats.isDirectory() });
                });
            });
        }).on('error', (err) => {
            res.status(500).json({ error: err.message });
        }).connect(sshConfig);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to get file permissions
function getFilePermissions(mode) {
    const perms = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
    const octal = mode.toString(8);
    const lastThree = octal.slice(-3);
    return lastThree.split('').map(n => perms[parseInt(n)]).join('');
}

// New route to browse remote files (without admin prefix)
app.get('/browse-remote-files', checkConnection, async (req, res) => {
  try {
    let { dir = '/' } = req.query;
    
    // Normalize the path
    dir = dir.replace(/\/+/g, '/'); // Replace multiple slashes with single slash
    if (!dir.startsWith('/')) {
      dir = '/' + dir;
    }
    
    console.log('Browsing remote directory:', { directory: dir });

    const fileList = await getRemoteFileList(dir, {
      host: req.app.locals.connectionDetails.host,
      port: req.app.locals.connectionDetails.port,
      username: req.app.locals.connectionDetails.username,
      password: req.app.locals.connectionDetails.password
    });

    console.log(`Found ${fileList.length} items in directory: ${dir}`);

    res.json({
      currentDir: dir,
      files: fileList
    });
  } catch (error) {
    console.error('Error browsing remote directory:', error);
    res.status(500).json({ 
      error: 'Failed to browse remote directory',
      details: error.message 
    });
  }
});

// New route to read remote file content (without admin prefix)
app.get('/read-remote-file', checkConnection, async (req, res) => {
  try {
    const { path: filePath } = req.query;
    
    console.log('Reading remote file:', { filePath });
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const fileContent = await readRemoteFileContent(filePath, {
      host: req.app.locals.connectionDetails.host,
      port: req.app.locals.connectionDetails.port,
      username: req.app.locals.connectionDetails.username,
      password: req.app.locals.connectionDetails.password
    });

    console.log(`Successfully read remote file: ${filePath}, size: ${fileContent.content.length} characters`);

    res.json({
      content: fileContent.content,
      size: fileContent.size
    });
  } catch (error) {
    console.error('Error reading remote file:', error);
    res.status(500).json({ 
      error: 'Failed to read remote file',
      details: error.message 
    });
  }
});

// Helper function to read remote file content
async function readRemoteFileContent(filePath, sshConfig) {
  return new Promise((resolve, reject) => {
    const { Client } = require('ssh2');
    const conn = new Client();

    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(new Error(`SFTP connection failed: ${err.message}`));
        }

        sftp.readFile(filePath, (err, data) => {
          conn.end();
          if (err) {
            return reject(new Error(`Failed to read remote file: ${err.message}`));
          }
          
          // Convert buffer to string with proper encoding
          const content = data.toString('utf8');
          resolve({
            content: content,
            size: data.length
          });
        });
      });
    }).on('error', (err) => {
      reject(new Error(`SSH connection failed: ${err.message}`));
    }).connect(sshConfig);
  });
}

// Get visualization tools list
app.get('/visualization-tools', (req, res) => {
  const visualizations = Object.values(visualizationConfig).map(viz => ({
    title: viz.title,
    toolName: viz.toolName,
    route: viz.route,
    icon: viz.icon
  }));
  res.json(visualizations);
});

// Serve visualization files
app.get('/visualization/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, 'public', 'visualization', filename);
  
  // Check if file exists
  if (!require('fs').existsSync(filePath)) {
    return res.status(404).json({ error: 'Visualization file not found' });
  }
  
  res.sendFile(filePath);
});

// Serve static files from public directory (including visualization files)
app.use('/visualization', express.static(path.join(__dirname, 'public', 'visualization')));

// Workflow Builder Routes
app.get('/workflow', checkConnection, (req, res) => {
  res.render('workflow');
});

// API Routes for Workflow Builder
app.get('/api/tools', (req, res) => {
  const tools = Object.values(toolsConfig).map(tool => ({
    toolName: tool.toolName,
    title: tool.title,
    route: tool.route,
    commandRoute: tool.commandRoute,
    usagePath: tool.usagePath,
    paraPath: tool.paraPath
  }));
  res.json(tools);
});

app.get('/api/visualization-tools', (req, res) => {
  const visualizations = Object.values(visualizationConfig).map(viz => ({
    toolName: viz.toolName,
    title: viz.title,
    route: viz.route,
    icon: viz.icon
  }));
  res.json(visualizations);
});

app.get('/api/tool-config/:toolName', async (req, res) => {
  try {
    const toolName = req.params.toolName;
    const tool = toolsConfig[toolName];
    
    if (!tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }
    
    // Load tool parameters
    const paraPath = path.join(__dirname, tool.paraPath);
    const usagePath = path.join(__dirname, tool.usagePath);
    
    let parameters = {};
    let description = '';
    
    try {
      const paraData = await fs.readFile(paraPath, 'utf8');
      const paraJson = JSON.parse(paraData);
      parameters = paraJson;
    } catch (error) {
      console.error(`Error loading parameters for ${toolName}:`, error);
    }
    
    try {
      const usageData = await fs.readFile(usagePath, 'utf8');
      const usageJson = JSON.parse(usageData);
      description = usageJson.description || '';
    } catch (error) {
      console.error(`Error loading usage for ${toolName}:`, error);
    }
    
    res.json({
      name: toolName,
      description: description,
      parameters: parameters,
      requiredInputs: ['input_file'], // Default required inputs
      outputs: ['output_file'] // Default outputs
    });
  } catch (error) {
    console.error('Error loading tool config:', error);
    res.status(500).json({ error: 'Failed to load tool configuration' });
  }
});

app.get('/api/server-files', checkConnection, async (req, res) => {
  try {
    const { dir = '/' } = req.query;
    
    const fileList = await getRemoteFileList(dir, {
      host: req.app.locals.connectionDetails.host,
      port: req.app.locals.connectionDetails.port,
      username: req.app.locals.connectionDetails.username,
      password: req.app.locals.connectionDetails.password
    });
    
    // Filter to show only files (not directories)
    const files = fileList.filter(item => !item.isDirectory);
    
    res.json(files);
  } catch (error) {
    console.error('Error loading server files:', error);
    res.status(500).json({ error: 'Failed to load server files' });
  }
});

app.get('/api/server-folders', checkConnection, async (req, res) => {
  try {
    const { dir = '/' } = req.query;
    
    const fileList = await getRemoteFileList(dir, {
      host: req.app.locals.connectionDetails.host,
      port: req.app.locals.connectionDetails.port,
      username: req.app.locals.connectionDetails.username,
      password: req.app.locals.connectionDetails.password
    });
    
    // Filter to show only directories
    const folders = fileList.filter(item => item.isDirectory);
    
    res.json(folders);
  } catch (error) {
    console.error('Error loading server folders:', error);
    res.status(500).json({ error: 'Failed to load server folders' });
  }
});

app.post('/api/run-workflow', checkConnection, async (req, res) => {
  try {
    const workflow = req.body;
    
    if (!workflow.nodes || workflow.nodes.length === 0) {
      return res.status(400).json({ error: 'No nodes in workflow' });
    }
    
    // Validate workflow
    const validation = validateWorkflow(workflow);
    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid workflow', details: validation.errors });
    }
    
    // Execute workflow
    const result = await executeWorkflow(workflow, req.app.locals.connectionDetails);
    
    res.json({
      success: true,
      result: result
    });
  } catch (error) {
    console.error('Error running workflow:', error);
    res.status(500).json({ error: 'Failed to run workflow', details: error.message });
  }
});

// New route for agent communication
app.post('/api/agent/ask', async (req, res) => {
  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Question is required' });
  }

  if (!app.locals.isAgentReady) {
    return res.status(503).json({ error: 'Agent is not ready yet. Please try again in a moment.' });
  }

  try {
    // Make a request to the Python agent and get a response stream
    const agentResponse = await axios({
      method: 'post',
      url: 'http://127.0.0.1:5111/ask',
      data: { question },
      responseType: 'stream'
    });

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Pipe the stream from the agent directly to the client
    agentResponse.data.pipe(res);

    agentResponse.data.on('error', (err) => {
        console.error('Error in agent stream:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Error in agent stream' });
        }
        res.end();
    });

  } catch (error) {
    console.error('Error communicating with agent:', error.message);
    if (!res.headersSent) {
      if (error.response) {
        // If the error is from the agent (e.g., bad request), forward it
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(500).json({ error: 'Failed to communicate with agent' });
      }
    }
  }
});

// New route for agent status
app.get('/api/agent/status', (req, res) => {
    res.json({ ready: app.locals.isAgentReady });
});

// Helper function to validate workflow
function validateWorkflow(workflow) {
  const errors = [];
  
  // Check for cycles
  const hasCycles = checkForCycles(workflow);
  if (hasCycles) {
    errors.push('Workflow contains cycles');
  }
  
  // Check for disconnected nodes
  const disconnectedNodes = findDisconnectedNodes(workflow);
  if (disconnectedNodes.length > 0) {
    errors.push(`Disconnected nodes: ${disconnectedNodes.join(', ')}`);
  }
  
  // Check for missing inputs
  const missingInputs = findMissingInputs(workflow);
  if (missingInputs.length > 0) {
    errors.push(`Missing inputs: ${missingInputs.join(', ')}`);
  }
  
  return {
    valid: errors.length === 0,
    errors: errors
  };
}

// Helper function to check for cycles in workflow
function checkForCycles(workflow) {
  const visited = new Set();
  const recStack = new Set();
  
  function hasCycle(nodeId) {
    if (recStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    
    visited.add(nodeId);
    recStack.add(nodeId);
    
    const outgoingConnections = workflow.connections.filter(conn => conn.fromNode === nodeId);
    for (const conn of outgoingConnections) {
      if (hasCycle(conn.toNode)) return true;
    }
    
    recStack.delete(nodeId);
    return false;
  }
  
  for (const node of workflow.nodes) {
    if (!visited.has(node.id)) {
      if (hasCycle(node.id)) return true;
    }
  }
  
  return false;
}

// Helper function to find disconnected nodes
function findDisconnectedNodes(workflow) {
  const connectedNodes = new Set();
  
  workflow.connections.forEach(conn => {
    connectedNodes.add(conn.fromNode);
    connectedNodes.add(conn.toNode);
  });
  
  return workflow.nodes
    .filter(node => !connectedNodes.has(node.id))
    .map(node => node.id);
}

// Helper function to find missing inputs
function findMissingInputs(workflow) {
  const missingInputs = [];
  
  for (const node of workflow.nodes) {
    if (node.type === 'tool' || node.type === 'visualization') {
      const hasInput = workflow.connections.some(conn => conn.toNode === node.id);
      if (!hasInput) {
        missingInputs.push(node.id);
      }
    }
  }
  
  return missingInputs;
}

// Helper function to execute workflow
async function executeWorkflow(workflow, connectionDetails) {
  const results = [];
  const executedNodes = new Set();
  
  // Topological sort to determine execution order
  const executionOrder = getExecutionOrder(workflow);
  
  for (const nodeId of executionOrder) {
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) continue;
    
    try {
      const result = await executeNode(node, workflow, connectionDetails, executedNodes);
      results.push({
        nodeId: nodeId,
        nodeType: node.type,
        success: true,
        result: result
      });
      executedNodes.add(nodeId);
    } catch (error) {
      results.push({
        nodeId: nodeId,
        nodeType: node.type,
        success: false,
        error: error.message
      });
      
      // Check if we should continue on error
      const nodeConfig = workflow.nodes.find(n => n.id === nodeId)?.config;
      if (!nodeConfig?.continueOnError) {
        break;
      }
    }
  }
  
  return results;
}

// Helper function to get execution order (topological sort)
function getExecutionOrder(workflow) {
  const inDegree = new Map();
  const graph = new Map();
  
  // Initialize
  workflow.nodes.forEach(node => {
    inDegree.set(node.id, 0);
    graph.set(node.id, []);
  });
  
  // Build graph and calculate in-degrees
  workflow.connections.forEach(conn => {
    const fromNode = conn.fromNode;
    const toNode = conn.toNode;
    
    graph.get(fromNode).push(toNode);
    inDegree.set(toNode, inDegree.get(toNode) + 1);
  });
  
  // Topological sort
  const queue = [];
  const order = [];
  
  // Add nodes with no incoming edges
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }
  
  while (queue.length > 0) {
    const nodeId = queue.shift();
    order.push(nodeId);
    
    for (const neighbor of graph.get(nodeId)) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }
  
  return order;
}

// Helper function to execute a single node
async function executeNode(node, workflow, connectionDetails, executedNodes) {
  switch (node.type) {
    case 'file-input':
      return await executeFileInput(node, workflow);
    case 'tool':
      return await executeTool(node, workflow, connectionDetails, executedNodes);
    case 'visualization':
      return await executeVisualization(node, workflow, executedNodes);
    case 'file-output':
      return await executeFileOutput(node, workflow, executedNodes);
    default:
      throw new Error(`Unknown node type: ${node.type}`);
  }
}

async function executeFileInput(node, workflow) {
  // File input nodes don't need execution, they just provide data
  return { message: 'File input ready' };
}

async function executeTool(node, workflow, connectionDetails, executedNodes) {
  // Get input files from connected nodes
  const inputFiles = getInputFiles(node.id, workflow, executedNodes);
  
  // Build command
  const command = buildToolCommand(node, inputFiles);
  
  // Execute command on remote server
  return await executeRemoteCommand(command, connectionDetails);
}

async function executeVisualization(node, workflow, executedNodes) {
  // Get input files from connected nodes
  const inputFiles = getInputFiles(node.id, workflow, executedNodes);
  
  // Generate visualization
  return { message: 'Visualization generated', inputFiles };
}

async function executeFileOutput(node, workflow, executedNodes) {
  // Get input files from connected nodes
  const inputFiles = getInputFiles(node.id, workflow, executedNodes);
  
  // Copy files to output location
  return { message: 'Files copied to output', inputFiles };
}

function getInputFiles(nodeId, workflow, executedNodes) {
  const inputConnections = workflow.connections.filter(conn => conn.toNode === nodeId);
  const inputFiles = [];
  
  for (const conn of inputConnections) {
    const sourceNode = workflow.nodes.find(n => n.id === conn.fromNode);
    if (sourceNode && executedNodes.has(sourceNode.id)) {
      // Get output files from source node
      inputFiles.push(...getNodeOutputFiles(sourceNode, workflow));
    }
  }
  
  return inputFiles;
}

function getNodeOutputFiles(node, workflow) {
  // This is a simplified version - in a real implementation,
  // you would track actual output files from each node
  switch (node.type) {
    case 'file-input':
      return node.config?.files || [];
    case 'tool':
      return [`${node.component}_output.txt`];
    case 'visualization':
      return [`${node.component}_viz.html`];
    default:
      return [];
  }
}

function buildToolCommand(node, inputFiles) {
  let command = node.component;
  
  // Add parameters
  if (node.config?.parameters) {
    Object.entries(node.config.parameters).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        command += ` --${key} ${value}`;
      }
    });
  }
  
  // Add input files
  if (inputFiles.length > 0) {
    command += ` ${inputFiles.join(' ')}`;
  }
  
  return command;
}

async function executeRemoteCommand(command, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        
        let stdout = '';
        let stderr = '';
        
        stream.on('close', (code) => {
          conn.end();
          if (code === 0) {
            resolve({ stdout, stderr, code });
          } else {
            reject(new Error(`Command failed with code ${code}: ${stderr}`));
          }
        }).on('data', (data) => {
          stdout += data.toString();
        }).stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect(connectionDetails);
  });
}

const PORT = process.env.PORT || 3010;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
