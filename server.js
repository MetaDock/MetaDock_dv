// Load environment variables from .env file
require('dotenv').config();

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

// API-specific middleware that returns JSON error instead of redirect
const checkConnectionAPI = (req, res, next) => {
  if (!req.app.locals.connectionDetails) {
    return res.status(401).json({ 
      error: 'No connection established', 
      message: 'Please establish server connection first' 
    });
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

// Theme testing page
app.get('/theme-test', (req, res) => {
  res.render('theme-test', { 
    title: 'Theme Toggle Test - MetaDock',
    connectionDetails: req.session.connectionDetails,
    isAdmin: req.session.isAdmin
  });
});

// Agent Widget testing page
app.get('/test-agent', (req, res) => {
  res.render('test-agent-widget', { 
    title: 'Agent Widget Test - MetaDock'
  });
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

    // Original direct execution route
    app.post(tool.commandRoute, commandHandler(tool));
    
    // New cluster execution route
    app.post(`${tool.commandRoute}/cluster`, async (req, res) => {
      if (!req.app.locals.connectionDetails) {
        console.log('[Cluster Request] Connection details not provided.');
        return res.status(400).json({ error: 'Connection details not provided.' });
      }

      const { command, clusterConfig } = req.body;
      console.log(`[Cluster Request] Command received: ${command}`);
      console.log(`[Cluster Config]:`, clusterConfig);

      try {
        // Build SLURM command
        const slurmCommand = buildSlurmCommand(command, clusterConfig);
        console.log(`[SLURM Command] ${slurmCommand}`);

        // Execute SLURM command via SSH
        const output = await executeClusterCommand(slurmCommand, req.app.locals.connectionDetails);
        
        console.log('[Cluster Execution] Command submitted successfully.');
        res.json({ 
          output: output,
          slurmCommand: slurmCommand,
          message: 'Cluster job submitted successfully'
        });
      } catch (error) {
        console.error('[Cluster Error]', error);
        res.status(500).json({ 
          error: 'Cluster execution failed',
          details: error.message 
        });
      }
    });
  
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
            tool: tool,
            picker: false
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

// Route for the workflow mockup page
app.get('/workflow-mock', checkConnection, (req, res) => {
  res.render('workflow-mock');
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
      if (usageData.trim()) {
        const usageJson = JSON.parse(usageData);
        description = usageJson.description || '';
      }
    } catch (error) {
      // Silently handle missing or invalid usage files
      console.log(`Usage file not available for ${toolName}, using default description`);
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

// API to list conda environments
app.get('/api/conda-environments', checkConnectionAPI, async (req, res) => {
  try {
    const connectionDetails = req.app.locals.connectionDetails;
    
    if (!connectionDetails) {
      return res.status(400).json({ error: 'No connection details available' });
    }

    const { Client } = require('ssh2');
    const conn = new Client();

    conn.on('ready', () => {
      // List conda environments - try multiple commands
      const commands = [
        'conda env list',
        '/opt/miniconda3/bin/conda env list',
        '/opt/conda/bin/conda env list',
        'source ~/.bashrc && conda env list',
        'eval "$(conda shell.bash hook)" && conda env list'
      ];
      
      let commandIndex = 0;
      
      function tryNextCommand() {
        if (commandIndex >= commands.length) {
          return res.status(500).json({ 
            error: 'All conda commands failed', 
            details: 'Could not find conda installation or conda is not in PATH'
          });
        }
        
        const command = commands[commandIndex];
        console.log(`Trying conda command ${commandIndex + 1}: ${command}`);
        
        conn.exec(command, (err, stream) => {
          if (err) {
            console.log(`Command ${commandIndex + 1} exec failed:`, err.message);
            commandIndex++;
            return tryNextCommand();
          }

          let output = '';
          let errorOutput = '';

          stream.on('close', (code) => {
            console.log(`Command ${commandIndex + 1} finished with code: ${code}`);
            console.log(`Output: ${output}`);
            console.log(`Error output: ${errorOutput}`);
            
            if (code !== 0) {
              console.log(`Command ${commandIndex + 1} failed, trying next...`);
              commandIndex++;
              return tryNextCommand();
            }

            // Parse conda env list output
            const environments = [];
            const lines = output.split('\n');
            
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith('#') && trimmed !== '') {
                // Parse environment name and path
                const parts = trimmed.split(/\s+/);
                if (parts.length >= 1) {
                  const envName = parts[0];
                  const envPath = parts.length > 1 ? parts[parts.length - 1] : '';
                  const isActive = trimmed.includes('*');
                  
                  if (envName) {  // Include base environment too
                    environments.push({
                      name: envName,
                      path: envPath,
                      active: isActive
                    });
                  }
                }
              }
            }

            conn.end();
            res.json({
              success: true,
              environments: environments,
              rawOutput: output,
              commandUsed: command
            });
          });

          stream.on('data', (data) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data) => {
            errorOutput += data.toString();
          });
        });
      }
      
      // Start trying commands
      tryNextCommand();
    });

    conn.on('error', (err) => {
      res.status(500).json({ error: 'SSH connection failed', details: err.message });
    });

    conn.connect(connectionDetails);

  } catch (error) {
    console.error('Error listing conda environments:', error);
    res.status(500).json({ error: 'Failed to list conda environments' });
  }
});

// Simple test API to check if conda is available
app.get('/api/conda-test', checkConnectionAPI, async (req, res) => {
  try {
    const connectionDetails = req.app.locals.connectionDetails;
    
    if (!connectionDetails) {
      return res.status(400).json({ error: 'No connection details available' });
    }

    const { Client } = require('ssh2');
    const conn = new Client();

    conn.on('ready', () => {
      conn.exec('which conda || echo "conda not found"', (err, stream) => {
        if (err) {
          conn.end();
          return res.status(500).json({ error: 'Failed to test conda' });
        }

        let output = '';
        
        stream.on('close', (code) => {
          conn.end();
          
          const condaPath = output.trim();
          const hasData = condaPath && !condaPath.includes('conda not found');
          
          res.json({
            success: true,
            condaAvailable: hasData,
            condaPath: hasData ? condaPath : null,
            message: hasData ? 'Conda is available' : 'Conda not found in PATH'
          });
        });

        stream.on('data', (data) => {
          output += data.toString();
        });
      });
    });

    conn.on('error', (err) => {
      res.status(500).json({ error: 'SSH connection failed', details: err.message });
    });

    conn.connect(connectionDetails);

  } catch (error) {
    console.error('Error testing conda:', error);
    res.status(500).json({ error: 'Failed to test conda availability' });
  }
});

// API to show raw server terminal conda output
app.get('/api/conda-terminal', checkConnectionAPI, async (req, res) => {
  try {
    const connectionDetails = req.app.locals.connectionDetails;
    
    if (!connectionDetails) {
      return res.status(400).json({ error: 'No connection details available' });
    }

    const { Client } = require('ssh2');
    const conn = new Client();

    conn.on('ready', () => {
      const commands = [
        'echo "=== Checking conda installation location ==="',
        'which conda 2>/dev/null || echo "conda not in PATH"',
        'echo "\\n=== Finding conda executable files ==="', 
        'find /opt -name "conda" -type f 2>/dev/null | head -5 || echo "conda not found"',
        'find /usr -name "conda" -type f 2>/dev/null | head -5 || echo "conda not found"',
        'echo "\\n=== Trying conda env list ==="',
        'conda env list 2>&1 || echo "conda env list failed"',
        'echo "\\n=== Trying full path ==="',
        '/opt/miniconda3/bin/conda env list 2>/dev/null || echo "/opt/miniconda3/bin/conda not found"',
        '/opt/anaconda3/bin/conda env list 2>/dev/null || echo "/opt/anaconda3/bin/conda not found"',
        'echo "\\n=== Checking conda configuration ==="',
        'ls -la ~/.condarc 2>/dev/null || echo "No .condarc file"',
        'echo "\\n=== Checking conda config in bashrc ==="',
        'grep -n conda ~/.bashrc 2>/dev/null | head -3 || echo "No conda config in .bashrc"',
        'echo "\\n=== Current PATH environment variable ==="',
        'echo $PATH | grep -o "[^:]*conda[^:]*" || echo "No conda in PATH"',
        'echo "\\n=== Check completed ==="'
      ];
      
      const fullCommand = commands.join(' && ');
      console.log('Executing conda terminal check:', fullCommand);
      
      conn.exec(fullCommand, (err, stream) => {
        if (err) {
          conn.end();
          return res.status(500).json({ error: 'Failed to execute terminal commands' });
        }

        let output = '';
        let errorOutput = '';

        stream.on('close', (code) => {
          conn.end();
          
          res.json({
            success: true,
            output: output,
            errorOutput: errorOutput,
            exitCode: code,
            timestamp: new Date().toISOString()
          });
        });

        stream.on('data', (data) => {
          output += data.toString();
        });

        stream.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
      });
    });

    conn.on('error', (err) => {
      res.status(500).json({ error: 'SSH connection failed', details: err.message });
    });

    conn.connect(connectionDetails);

  } catch (error) {
    console.error('Error running conda terminal check:', error);
    res.status(500).json({ error: 'Failed to run conda terminal check' });
  }
});

// In-memory storage for workflow status
const workflowJobs = new Map();

// Generic workflow execution system for any tool combination
app.post('/api/run-generic-workflow', checkConnectionAPI, async (req, res) => {
  try {
    const { workflow, executionPlan, commands, workingDir } = req.body;
    const connectionDetails = req.app.locals.connectionDetails;
    
    if (!connectionDetails) {
      return res.status(400).json({ error: 'No connection details available' });
    }

    // Generate unique job ID
    const jobId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`Starting workflow job ${jobId}`);
    console.log('Execution order:', executionPlan.map(step => step.component));
    console.log('Commands:', commands.map(cmd => `${cmd.component}: ${cmd.command}`));

    const executionResults = {
      jobId: jobId,
      status: 'running',
      steps: [],
      startTime: new Date().toISOString(),
      workingDir: workingDir,
      workflow: workflow,
      executionPlan: executionPlan,
      commands: commands,
      progress: 0,
      currentStep: null
    };
    
    // Store job in memory
    workflowJobs.set(jobId, executionResults);
    
    // Return job ID immediately for background execution
    res.json({
      success: true,
      message: 'Workflow started in background',
      jobId: jobId,
      status: 'running'
    });

    // Execute workflow in background
    const conn = new Client();

    conn.on('ready', () => {
      console.log('SSH connection ready for generic workflow execution');
      
      // Execute commands in sequence according to execution plan
      executeNextCommand(0);
      
      function executeNextCommand(stepIndex) {
        if (stepIndex >= commands.length) {
          // All commands completed
          executionResults.endTime = new Date().toISOString();
          executionResults.totalSteps = commands.length;
          executionResults.successfulSteps = executionResults.steps.filter(step => step.exitCode === 0).length;
          executionResults.progress = 100;
          executionResults.currentStep = null;
          
          const allSuccessful = executionResults.successfulSteps === executionResults.totalSteps;
          executionResults.status = allSuccessful ? 'completed' : 'failed';
          executionResults.message = allSuccessful ? 
            `Generic workflow completed successfully! Executed ${executionResults.totalSteps} tools.` : 
            `Workflow completed with ${executionResults.successfulSteps}/${executionResults.totalSteps} successful steps.`;
          
          // Update job status
          workflowJobs.set(jobId, executionResults);
          
          conn.end();
          console.log(`Workflow job ${jobId} completed with status: ${executionResults.status}`);
          return;
        }
        
        const currentCommand = commands[stepIndex];
        console.log(`Executing step ${stepIndex + 1}/${commands.length}: ${currentCommand.component}`);
        
        // Update job status
        executionResults.progress = Math.round((stepIndex / commands.length) * 100);
        executionResults.currentStep = currentCommand.component;
        workflowJobs.set(jobId, executionResults);
        
        // Build full command with conda activation and environment setup
        let fullCommand = `
          source ~/.bashrc 2>/dev/null || true &&
          cd ${workingDir} && 
          echo "=== Executing ${currentCommand.component} ===" &&
        `;
        
        // Add test data creation for SPAdes if needed
        if (currentCommand.component === 'spades') {
          fullCommand += `
          echo "Creating test data files if they don't exist..." &&
          [ ! -f left.fastq.gz ] && printf "@read1\\nACGTACGTACGT\\n+\\nIIIIIIIIIIII\\n" | gzip > left.fastq.gz || echo "left.fastq.gz already exists" &&
          [ ! -f right.fastq.gz ] && printf "@read2\\nTGCATGCATGCA\\n+\\nIIIIIIIIIIII\\n" | gzip > right.fastq.gz || echo "right.fastq.gz already exists" &&
          `;
        }
        
        fullCommand += `
          export PATH="/home/hoshigawarei/miniconda3/bin:$PATH" &&
          eval "$(/home/hoshigawarei/miniconda3/bin/conda shell.bash hook)" &&
          echo "Checking if conda environment '${currentCommand.condaEnv}' exists..." &&
          conda env list | grep -q "^${currentCommand.condaEnv}\\s" || (echo "ERROR: Conda environment '${currentCommand.condaEnv}' not found!" && exit 1) &&
          conda activate ${currentCommand.condaEnv} &&
          echo "Activated environment: $CONDA_DEFAULT_ENV" &&
          echo "Checking if ${currentCommand.component}.py is available..." &&
          which ${currentCommand.component}.py || (echo "ERROR: ${currentCommand.component}.py not found in environment '${currentCommand.condaEnv}'!" && echo "Please install ${currentCommand.component} in this environment." && exit 1) &&
          ${currentCommand.command}
        `;
        
        console.log(`Executing command: ${fullCommand}`);
        
        conn.exec(fullCommand, (err, stream) => {
          if (err) {
            console.error(`Failed to execute command for ${currentCommand.component}:`, err);
            executionResults.steps.push({
              tool: currentCommand.component,
              nodeId: currentCommand.nodeId,
              command: fullCommand,
              exitCode: -1,
              output: '',
              error: `Failed to execute: ${err.message}`,
              timestamp: new Date().toISOString()
            });
            
            // Continue with next command even if this one failed
            executeNextCommand(stepIndex + 1);
            return;
          }

          let output = '';
          let error = '';

          stream.on('close', (code) => {
            console.log(`${currentCommand.component} finished with code: ${code}`);
            
            executionResults.steps.push({
              tool: currentCommand.component,
              nodeId: currentCommand.nodeId,
              command: fullCommand,
              exitCode: code,
              output: output,
              error: error,
              timestamp: new Date().toISOString()
            });

            // Continue with next command
            executeNextCommand(stepIndex + 1);
          });

          stream.on('data', (data) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data) => {
            error += data.toString();
          });
        });
      }
    });

    conn.on('error', (err) => {
      console.error('SSH connection error:', err);
      res.status(500).json({ 
        error: 'SSH connection failed',
        details: err.message 
      });
    });

    conn.connect(connectionDetails);

  } catch (error) {
    console.error('Error running generic workflow:', error);
    
    // Update job status on error
    if (executionResults && executionResults.jobId) {
      executionResults.status = 'failed';
      executionResults.error = error.message;
      workflowJobs.set(executionResults.jobId, executionResults);
    }
    
    res.status(500).json({ error: 'Failed to run generic workflow', details: error.message });
  }
});

// Get workflow job status
app.get('/api/workflow-status/:jobId', checkConnectionAPI, (req, res) => {
  const { jobId } = req.params;
  
  if (!workflowJobs.has(jobId)) {
    return res.status(404).json({ error: 'Workflow job not found' });
  }
  
  const job = workflowJobs.get(jobId);
  res.json(job);
});

// Get all workflow jobs
app.get('/api/workflow-jobs', checkConnectionAPI, (req, res) => {
  const jobs = Array.from(workflowJobs.values()).map(job => ({
    jobId: job.jobId,
    status: job.status,
    startTime: job.startTime,
    endTime: job.endTime,
    progress: job.progress,
    currentStep: job.currentStep,
    totalSteps: job.totalSteps,
    successfulSteps: job.successfulSteps,
    workflow: {
      nodes: job.workflow.nodes.length,
      tools: job.executionPlan.map(step => step.component)
    }
  }));
  
  res.json(jobs);
});

// Real SPAdes + QUAST workflow execution with user configuration
app.post('/api/run-real-spades-quast', checkConnectionAPI, async (req, res) => {
  try {
    const { workingDir, spadesEnv, quastEnv, spadesCommand, quastCommand, workflow } = req.body;
    const connectionDetails = req.app.locals.connectionDetails;
    
    if (!connectionDetails) {
      return res.status(400).json({ error: 'No connection details available' });
    }

    console.log('Running real SPAdes + QUAST workflow with commands:');
    console.log('SPAdes:', spadesCommand);
    console.log('QUAST:', quastCommand);

    const conn = new Client();
    const executionResults = {
      steps: [],
      startTime: new Date().toISOString(),
      workingDir: workingDir,
      environments: { spadesEnv, quastEnv },
      commands: { spadesCommand, quastCommand },
      workflow: workflow
    };

    conn.on('ready', () => {
      console.log('SSH connection ready for real workflow execution');
      
      // First, detect conda installation and environments
      const detectCommand = `
        echo "=== Real Workflow Detection ==="
        source ~/.bashrc 2>/dev/null || true
        export PATH="/home/hoshigawarei/miniconda3/bin:$PATH"
        which conda 2>/dev/null && echo "✅ conda found" || echo "❌ conda not found"
        eval "$(/home/hoshigawarei/miniconda3/bin/conda shell.bash hook)" 2>/dev/null || true
        conda env list 2>/dev/null | grep -E "(${spadesEnv}|${quastEnv})" && echo "✅ environments found" || echo "❌ environments not found"
        echo "Files in ${workingDir}:"
        ls -la ${workingDir}/ | head -5
        echo "=== Detection Complete ==="
      `;
      
      conn.exec(detectCommand, (err, stream) => {
        if (err) {
          console.log('Detection command failed, proceeding with execution');
          executeRealSpades();
          return;
        }

        let detectionOutput = '';
        
        stream.on('close', (code) => {
          console.log('Detection output:', detectionOutput);
          executionResults.detection = detectionOutput;
          executeRealSpades();
        });

        stream.on('data', (data) => {
          detectionOutput += data.toString();
        });
      });

      function executeRealSpades() {
        // Step 1: Run SPAdes with user-configured command
        const fullSpadesCommand = `
          source ~/.bashrc 2>/dev/null || true &&
          cd ${workingDir} && 
          echo "Creating test data files if they don't exist..." &&
          [ ! -f left.fastq.gz ] && printf "@read1\\nACGTACGTACGT\\n+\\nIIIIIIIIIIII\\n" | gzip > left.fastq.gz || echo "left.fastq.gz already exists" &&
          [ ! -f right.fastq.gz ] && printf "@read2\\nTGCATGCATGCA\\n+\\nIIIIIIIIIIII\\n" | gzip > right.fastq.gz || echo "right.fastq.gz already exists" &&
          export PATH="/home/hoshigawarei/miniconda3/bin:$PATH" &&
          eval "$(/home/hoshigawarei/miniconda3/bin/conda shell.bash hook)" &&
          conda activate ${spadesEnv} &&
          echo "Activated environment: $CONDA_DEFAULT_ENV" &&
          which spades.py &&
          ${spadesCommand}
        `;
        
        console.log('Executing real SPAdes command:', fullSpadesCommand);
      
        conn.exec(fullSpadesCommand, (err, stream) => {
          if (err) {
            conn.end();
            return res.status(500).json({ 
              error: 'Failed to execute SPAdes command',
              details: err.message 
            });
          }

          let spadesOutput = '';
          let spadesError = '';

          stream.on('close', (code) => {
            console.log(`Real SPAdes finished with code: ${code}`);
            
            executionResults.steps.push({
              tool: 'SPAdes',
              command: fullSpadesCommand,
              exitCode: code,
              output: spadesOutput,
              error: spadesError,
              timestamp: new Date().toISOString()
            });

            if (code !== 0) {
              conn.end();
              return res.json({
                success: false,
                error: 'SPAdes execution failed',
                results: executionResults
              });
            }

            executeRealQuast();
          });

          stream.on('data', (data) => {
            spadesOutput += data.toString();
          });

          stream.stderr.on('data', (data) => {
            spadesError += data.toString();
          });
        });
      }

      function executeRealQuast() {
        // Step 2: Run QUAST with user-configured command
        const fullQuastCommand = `
          source ~/.bashrc 2>/dev/null || true &&
          cd ${workingDir} && 
          export PATH="/home/hoshigawarei/miniconda3/bin:$PATH" &&
          eval "$(/home/hoshigawarei/miniconda3/bin/conda shell.bash hook)" &&
          conda activate ${quastEnv} &&
          echo "Activated environment: $CONDA_DEFAULT_ENV" &&
          which quast.py &&
          ${quastCommand}
        `;
        
        console.log('Executing real QUAST command:', fullQuastCommand);
        
        conn.exec(fullQuastCommand, (err, stream) => {
          if (err) {
            conn.end();
            return res.status(500).json({ 
              error: 'Failed to execute QUAST command',
              details: err.message 
            });
          }

          let quastOutput = '';
          let quastError = '';

          stream.on('close', (code) => {
            console.log(`Real QUAST finished with code: ${code}`);
            
            executionResults.steps.push({
              tool: 'QUAST',
              command: fullQuastCommand,
              exitCode: code,
              output: quastOutput,
              error: quastError,
              timestamp: new Date().toISOString()
            });

            executionResults.endTime = new Date().toISOString();
            executionResults.totalSteps = 2;
            executionResults.successfulSteps = executionResults.steps.filter(step => step.exitCode === 0).length;

            conn.end();
            
            res.json({
              success: code === 0,
              message: code === 0 ? 'Real SPAdes + QUAST workflow completed successfully' : 'QUAST execution failed',
              results: executionResults
            });
          });

          stream.on('data', (data) => {
            quastOutput += data.toString();
          });

          stream.stderr.on('data', (data) => {
            quastError += data.toString();
          });
        });
      }
    });

    conn.on('error', (err) => {
      console.error('SSH connection error:', err);
      res.status(500).json({ 
        error: 'SSH connection failed',
        details: err.message 
      });
    });

    conn.connect(connectionDetails);

  } catch (error) {
    console.error('Error running real SPAdes + QUAST workflow:', error);
    res.status(500).json({ error: 'Failed to run real workflow' });
  }
});

// Mock SPAdes + QUAST workflow execution
app.post('/api/run-mock-spades-quast', checkConnectionAPI, async (req, res) => {
  try {
    const { workingDir, spadesEnv, quastEnv } = req.body;
    const connectionDetails = req.app.locals.connectionDetails;
    
    if (!connectionDetails) {
      return res.status(400).json({ error: 'No connection details available' });
    }

    console.log('🧬 Starting mock SPAdes + QUAST workflow execution...');
    console.log('Working directory:', workingDir);
    console.log('SPAdes environment:', spadesEnv);
    console.log('QUAST environment:', quastEnv);

    const { Client } = require('ssh2');
    const conn = new Client();

    const executionResults = {
      steps: [],
      startTime: new Date().toISOString(),
      workingDir: workingDir,
      environments: { spadesEnv, quastEnv }
    };

    conn.on('ready', () => {
      console.log('SSH connection ready for workflow execution');
      
      // First, detect conda installation and environments
      const detectCommand = `
        echo "=== Conda Detection ==="
        source ~/.bashrc 2>/dev/null || true
        export PATH="/home/hoshigawarei/miniconda3/bin:$PATH"
        which conda 2>/dev/null && echo "✅ conda found" || echo "❌ conda not found"
        eval "$(/home/hoshigawarei/miniconda3/bin/conda shell.bash hook)" 2>/dev/null || true
        conda env list 2>/dev/null | grep -E "(spades_env|quast_env)" && echo "✅ environments found" || echo "❌ environments not found"
        echo "Testing spades_env activation:"
        conda activate spades_env 2>/dev/null && echo "✅ spades_env activated: $CONDA_DEFAULT_ENV" || echo "❌ spades_env activation failed"
        conda deactivate 2>/dev/null || true
        echo "Testing quast_env activation:"
        conda activate quast_env 2>/dev/null && echo "✅ quast_env activated: $CONDA_DEFAULT_ENV" || echo "❌ quast_env activation failed"
        conda deactivate 2>/dev/null || true
        echo "Files in ${workingDir}:"
        ls -la ${workingDir}/ | head -5
        echo "Checking for test data files:"
        ls -la ${workingDir}/left.fastq.gz 2>/dev/null && echo "✅ left.fastq.gz found" || echo "❌ left.fastq.gz not found"
        ls -la ${workingDir}/right.fastq.gz 2>/dev/null && echo "✅ right.fastq.gz found" || echo "❌ right.fastq.gz not found"
        echo "=== Detection Complete ==="
      `;
      
      conn.exec(detectCommand, (err, stream) => {
        if (err) {
          console.log('Detection command failed, proceeding with original approach');
          executeSpades();
          return;
        }

        let detectionOutput = '';
        
        stream.on('close', (code) => {
          console.log('Detection output:', detectionOutput);
          executionResults.detection = detectionOutput;
          executeSpades();
        });

        stream.on('data', (data) => {
          detectionOutput += data.toString();
        });
      });

      function executeSpades() {
        // Step 1: Run SPAdes with proper conda initialization
        const spadesCommand = `
          source ~/.bashrc 2>/dev/null || true &&
          cd ${workingDir} && 
          echo "Creating test data files if they don't exist..." &&
          [ ! -f left.fastq.gz ] && printf "@read1\\nACGTACGTACGT\\n+\\nIIIIIIIIIIII\\n" | gzip > left.fastq.gz || echo "left.fastq.gz already exists" &&
          [ ! -f right.fastq.gz ] && printf "@read2\\nTGCATGCATGCA\\n+\\nIIIIIIIIIIII\\n" | gzip > right.fastq.gz || echo "right.fastq.gz already exists" &&
          export PATH="/home/hoshigawarei/miniconda3/bin:$PATH" &&
          eval "$(/home/hoshigawarei/miniconda3/bin/conda shell.bash hook)" &&
          conda activate spades_env &&
          echo "Activated environment: $CONDA_DEFAULT_ENV" &&
          which spades.py &&
          spades.py -1 left.fastq.gz -2 right.fastq.gz -o spades_output_folder
        `;
        
        console.log('Executing SPAdes command:', spadesCommand);
      
      conn.exec(spadesCommand, (err, stream) => {
        if (err) {
          conn.end();
          return res.status(500).json({ 
            error: 'Failed to execute SPAdes command',
            details: err.message 
          });
        }

        let spadesOutput = '';
        let spadesError = '';

        stream.on('close', (code) => {
          console.log(`SPAdes finished with code: ${code}`);
          
          executionResults.steps.push({
            tool: 'SPAdes',
            command: spadesCommand,
            exitCode: code,
            output: spadesOutput,
            error: spadesError,
            timestamp: new Date().toISOString()
          });

          if (code !== 0) {
            conn.end();
            return res.json({
              success: false,
              error: 'SPAdes execution failed',
              results: executionResults
            });
          }

          executeQuast();
        });

        stream.on('data', (data) => {
          spadesOutput += data.toString();
        });

        stream.stderr.on('data', (data) => {
          spadesError += data.toString();
        });
      });
      }

      function executeQuast() {
        // Step 2: Run QUAST with proper conda initialization
        const quastCommand = `
          source ~/.bashrc 2>/dev/null || true &&
          cd ${workingDir} && 
          export PATH="/home/hoshigawarei/miniconda3/bin:$PATH" &&
          eval "$(/home/hoshigawarei/miniconda3/bin/conda shell.bash hook)" &&
          conda activate quast_env &&
          echo "Activated environment: $CONDA_DEFAULT_ENV" &&
          which quast.py &&
          quast.py spades_output_folder/contigs.fasta -o quast_output_dir
        `;
        
        console.log('Executing QUAST command:', quastCommand);
        
        conn.exec(quastCommand, (err, stream) => {
          if (err) {
            conn.end();
            return res.status(500).json({ 
              error: 'Failed to execute QUAST command',
              details: err.message 
            });
          }

          let quastOutput = '';
          let quastError = '';

          stream.on('close', (code) => {
            console.log(`QUAST finished with code: ${code}`);
            
            executionResults.steps.push({
              tool: 'QUAST',
              command: quastCommand,
              exitCode: code,
              output: quastOutput,
              error: quastError,
              timestamp: new Date().toISOString()
            });

            executionResults.endTime = new Date().toISOString();
            executionResults.totalSteps = 2;
            executionResults.successfulSteps = executionResults.steps.filter(step => step.exitCode === 0).length;

            conn.end();
            
            res.json({
              success: code === 0,
              message: code === 0 ? 'SPAdes + QUAST workflow completed successfully' : 'QUAST execution failed',
              results: executionResults
            });
          });

          stream.on('data', (data) => {
            quastOutput += data.toString();
          });

          stream.stderr.on('data', (data) => {
            quastError += data.toString();
          });
        });
      }
    });

    conn.on('error', (err) => {
      console.error('SSH connection error:', err);
      res.status(500).json({ 
        error: 'SSH connection failed', 
        details: err.message,
        results: executionResults 
      });
    });

    conn.connect(connectionDetails);

  } catch (error) {
    console.error('Error running mock workflow:', error);
    res.status(500).json({ error: 'Failed to run mock workflow', details: error.message });
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

// 文件浏览器页面路由
app.get('/browse-files', checkConnection, (req, res) => {
  const { type = 'input' } = req.query;
  // 模板文件名为 file-browser.ejs
  res.render('file-browser', { 
    type,
    currentDir: '/',
    filelist: [],
    tool: 'browse-files',
    picker: false
  });
});

// 轻量文件选择器（用于嵌入式弹窗）
app.get('/picker/file-browser', checkConnection, async (req, res) => {
  try {
    let dir = req.query.dir || '/';
    dir = dir.replace(/\/+/g, '/');
    if (!dir.startsWith('/')) dir = '/' + dir;

    const connectionDetails = req.app.locals.connectionDetails;
    if (!connectionDetails) {
      return res.status(401).send('Not connected to remote server');
    }

    const filelist = await getRemoteFileList(dir, {
      host: connectionDetails.host,
      port: connectionDetails.port,
      username: connectionDetails.username,
      password: connectionDetails.password
    });

    res.render('file-picker', {
      type: req.query.type || 'input',
      currentDir: dir,
      filelist,
      tool: 'picker',
      picker: true
    });
  } catch (error) {
    console.error('Error in picker file browser:', error);
    res.status(500).send('Error accessing file browser: ' + error.message);
  }
});

// 方便直接访问 /picker 时跳转到嵌入式文件选择器
app.get('/picker', checkConnection, (req, res) => {
  res.redirect('/picker/file-picker?dir=/&type=input&picker=1');
});

// 新路径 /picker/file-picker 指向同一模板
app.get('/picker/file-picker', checkConnection, async (req, res) => {
  try {
    let dir = req.query.dir || '/';
    dir = dir.replace(/\/+/g, '/');
    if (!dir.startsWith('/')) dir = '/' + dir;

    const connectionDetails = req.app.locals.connectionDetails;
    if (!connectionDetails) {
      return res.status(401).send('Not connected to remote server');
    }

    const filelist = await getRemoteFileList(dir, {
      host: connectionDetails.host,
      port: connectionDetails.port,
      username: connectionDetails.username,
      password: connectionDetails.password
    });

    res.render('file-picker', {
      type: req.query.type || 'input',
      currentDir: dir,
      filelist,
      tool: 'picker',
      picker: true
    });
  } catch (error) {
    console.error('Error in picker file picker:', error);
    res.status(500).send('Error accessing file picker: ' + error.message);
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
  const { question, sessionId } = req.body;
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
      data: { question, sessionId },
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

// Model management routes
app.get('/api/agent/models', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:5111/models');
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error getting models:', error);
    res.status(500).json({ error: 'Failed to get models' });
  }
});

app.post('/api/agent/switch-model', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:5111/switch-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error switching model:', error);
    res.status(500).json({ error: 'Failed to switch model' });
  }
});

app.post('/api/agent/test-model', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:5111/test-model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Error testing model:', error);
    res.status(500).json({ error: 'Failed to test model' });
  }
});

// === Session Management Routes ===

// 获取所有会话列表
app.get('/api/agent/sessions', async (req, res) => {
  try {
    const response = await axios.get('http://127.0.0.1:5111/sessions');
    res.json(response.data);
  } catch (error) {
    console.error('Error getting sessions:', error.message);
    res.status(500).json({ error: 'Failed to get sessions list' });
  }
});

// 开始新会话
app.post('/api/agent/sessions/new', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const response = await axios.post('http://127.0.0.1:5111/sessions/new', {
      session_id: sessionId
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error starting new session:', error.message);
    res.status(500).json({ error: 'Failed to start new session' });
  }
});

// 加载指定会话
app.post('/api/agent/sessions/:sessionId/load', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const response = await axios.post(`http://127.0.0.1:5111/sessions/${sessionId}/load`);
    res.json(response.data);
  } catch (error) {
    console.error('Error loading session:', error.message);
    if (error.response && error.response.status === 404) {
      res.status(404).json({ error: 'Session not found' });
    } else {
      res.status(500).json({ error: 'Failed to load session' });
    }
  }
});

// 删除指定会话
app.delete('/api/agent/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const response = await axios.delete(`http://127.0.0.1:5111/sessions/${sessionId}`);
    res.json(response.data);
  } catch (error) {
    console.error('Error deleting session:', error.message);
    if (error.response && error.response.status === 404) {
      res.status(404).json({ error: 'Session not found' });
    } else {
      res.status(500).json({ error: 'Failed to delete session' });
    }
  }
});

// 保存当前会话
app.post('/api/agent/sessions/save', async (req, res) => {
  try {
    const response = await axios.post('http://127.0.0.1:5111/sessions/save');
    res.json(response.data);
  } catch (error) {
    console.error('Error saving session:', error.message);
    res.status(500).json({ error: 'Failed to save current session' });
  }
});

// 清理旧会话
app.post('/api/agent/sessions/cleanup', async (req, res) => {
  try {
    const { daysToKeep = 30 } = req.body;
    const response = await axios.post('http://127.0.0.1:5111/sessions/cleanup', {
      days_to_keep: daysToKeep
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error cleaning up sessions:', error.message);
    res.status(500).json({ error: 'Failed to cleanup old sessions' });
  }
});

// 获取会话历史记录
app.get('/api/agent/history', async (req, res) => {
  try {
    const response = await axios.get('http://127.0.0.1:5111/history');
    res.json(response.data);
  } catch (error) {
    console.error('Error getting conversation history:', error.message);
    res.status(500).json({ error: 'Failed to get conversation history' });
  }
});

// 清除会话历史记录
app.post('/api/agent/clear-history', async (req, res) => {
  try {
    const response = await axios.post('http://127.0.0.1:5111/clear-history');
    res.json(response.data);
  } catch (error) {
    console.error('Error clearing conversation history:', error.message);
    res.status(500).json({ error: 'Failed to clear conversation history' });
  }
});

// 读取远程文件头部，返回原文与列名（简单 CSV/TSV 推断）
async function getRemoteFileHead(filePath, connectionDetails, lines = 5) {
  const safePath = filePath.replace(/(["'\\])/g, '\\$1');
  const { stdout } = await executeRemoteCommand(`head -n ${lines} "${safePath}"`, connectionDetails);
  const headContent = stdout || '';
  const firstLine = headContent.split(/\r?\n/).find(Boolean) || '';
  // 估算分隔符
  let delimiter = ',';
  if (firstLine.includes('\t')) delimiter = '\t';
  else if (firstLine.includes(';')) delimiter = ';';
  const cols = firstLine.split(delimiter).map(c => c.trim()).filter(Boolean);
  return { headContent, columns: cols };
}

// === Visualization Codegen & Run ===
// Proxy to Python agent for seaborn code generation
app.post('/api/viz/codegen', async (req, res) => {
  try {
    let payload = { ...req.body };

    // 如果提供 file_path，先读取头部，传给 Agent 作为列提示
    if (payload.file_path && req.app.locals.connectionDetails) {
      try {
        const { headContent, columns } = await getRemoteFileHead(payload.file_path, req.app.locals.connectionDetails, 5);
        payload.detected_columns = columns;
        payload.file_head = headContent;
      } catch (err) {
        console.warn('Failed to read remote file head:', err.message);
      }
    }

    const response = await axios.post('http://127.0.0.1:5111/viz/codegen', payload);
    res.json(response.data);
  } catch (error) {
    console.error('Error generating viz code:', error.message);
    if (error.response) {
      return res.status(error.response.status || 500).json(error.response.data);
    }
    res.status(500).json({ error: 'Failed to generate visualization code' });
  }
});

// Run generated seaborn code on remote server and return image
app.post('/api/viz/run', checkConnectionAPI, async (req, res) => {
  try {
    const { code, format = 'png' } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    const connectionDetails = req.app.locals.connectionDetails;
    if (!connectionDetails) {
      return res.status(401).json({ error: 'No connection established' });
    }

    const remoteTmp = process.env.VIZ_REMOTE_TMP || '/home/hoshigawarei/tmp/metadock_viz';
    const ts = Date.now();
    const scriptPath = `${remoteTmp}/viz_${ts}.py`;
    let imagePath = `${remoteTmp}/viz_${ts}.${format}`;

    // Ensure remote tmp directory exists
    await ensureRemoteDir(remoteTmp, connectionDetails);

    // Prepare final script content - force OUTPUT_PATH override
    let finalCode = code.replace(/__OUTPUT_PATH__/g, imagePath);
    // Always override OUTPUT_PATH to ensure absolute path
    finalCode = `OUTPUT_PATH = r"${imagePath}"\n` + finalCode.replace(/OUTPUT_PATH\\s*=\\s*['"][^'"]+['"]/g, '');

    // Prepend Agg backend to avoid GUI issues
    if (!finalCode.includes('matplotlib.use("Agg")')) {
      finalCode = `import matplotlib\\nmatplotlib.use("Agg")\\n` + finalCode;
    }

    const scriptContent = `
import os, pathlib
${finalCode}
if not os.path.isfile(OUTPUT_PATH):
    raise SystemExit(f"Output image not found: {OUTPUT_PATH}")
print(f"[VIZ_OUTPUT]{OUTPUT_PATH}")
`;

    await uploadTextFile(scriptPath, scriptContent, connectionDetails);

    // Execute script
    const execResult = await executeRemoteCommand(`cd ${remoteTmp} && ${process.env.VIZ_PYTHON || 'python3'} ${scriptPath}`, connectionDetails);    

    // Ensure image exists before download
    let exists = await remoteFileExists(imagePath, connectionDetails);
    if (!exists) {
      const fallback = await findRecentPng(remoteTmp, ts, connectionDetails);
      if (fallback) {
        imagePath = fallback.fullPath;
        exists = true;
      }
    }
    if (!exists) {
      return res.status(500).json({ error: `Output image not found at ${imagePath}`, stdout: execResult?.stdout, stderr: execResult?.stderr });
    }

    // Download image
    const imageBuffer = await downloadRemoteFile(imagePath, connectionDetails);
    const base64 = imageBuffer.toString('base64');

    res.json({
      success: true,
      imageBase64: base64,
      imagePath,
      format,
      stdout: execResult?.stdout,
      stderr: execResult?.stderr
    });
  } catch (error) {
    console.error('Error running visualization:', error);
    res.status(500).json({ error: 'Failed to run visualization', details: error.message, stderr: error.stderr, stdout: error.stdout });
  }
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
      if (node.component === 'spades') {
        const outputDir = node.config?.['o'] || node.config?.['output-dir'] || 'spades_output';
        return [`${outputDir}/contigs.fasta`, `${outputDir}/scaffolds.fasta`];
      } else if (node.component === 'quast') {
        const outputDir = node.config?.['o'] || node.config?.['output-dir'] || 'quast_output';
        return [`${outputDir}/report.html`, `${outputDir}/report.txt`];
      } else {
        return [`${node.component}_output.txt`];
      }
    case 'visualization':
      return [`${node.component}_viz.html`];
    default:
      return [];
  }
}

function buildToolCommand(node, inputFiles) {
  let command = '';
  
  // Check if conda environment is specified
  const condaEnv = node.config?.['conda-env'] || node.config?.['conda_env'];
  if (condaEnv) {
    command = `conda activate ${condaEnv} && `;
  }
  
  // Add the base tool command
  if (node.component === 'spades') {
    command += 'spades.py';
  } else if (node.component === 'quast') {
    command += 'quast.py';
  } else {
    command += node.component;
  }
  
  // Add parameters
  if (node.config) {
    Object.entries(node.config).forEach(([key, value]) => {
      if (key === 'conda-env' || key === 'conda_env') {
        // Skip conda environment as it's already handled
        return;
      }
      
      if (value !== null && value !== undefined && value !== '' && value !== false) {
        if (value === true) {
          // Boolean flag without value
          command += ` --${key}`;
        } else {
          // Parameter with value
          if (key.length === 1) {
            command += ` -${key} ${value}`;
          } else {
            command += ` --${key} ${value}`;
          }
        }
      }
    });
  }
  
  // Add input files for specific tools
  if (node.component === 'quast' && inputFiles.length > 0) {
    // For QUAST, input files come first
    command += ` ${inputFiles.join(' ')}`;
  } else if (inputFiles.length > 0 && !node.config?.['-1'] && !node.config?.['1']) {
    // Add input files if not already specified in parameters
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

async function ensureRemoteDir(dirPath, connectionDetails) {
  const safeDir = dirPath.replace(/"/g, '\\"');
  await executeRemoteCommand(`mkdir -p "${safeDir}"`, connectionDetails);
}

async function uploadTextFile(remotePath, content, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        const writeStream = sftp.createWriteStream(remotePath, { encoding: 'utf8' });
        writeStream.on('close', () => {
          conn.end();
          resolve(true);
        });
        writeStream.on('error', (error) => {
          conn.end();
          reject(error);
        });
        writeStream.write(content);
        writeStream.end();
      });
    }).on('error', (err) => {
      reject(err);
    }).connect(connectionDetails);
  });
}

async function downloadRemoteFile(remotePath, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        sftp.readFile(remotePath, (readErr, data) => {
          conn.end();
          if (readErr) {
            return reject(readErr);
          }
          resolve(data);
        });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect(connectionDetails);
  });
}

async function remoteFileExists(remotePath, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        sftp.stat(remotePath, (statErr) => {
          conn.end();
          if (statErr) {
            return resolve(false);
          }
          return resolve(true);
        });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect(connectionDetails);
  });
}

// Find recent png in directory (mtime >= sinceTs - 5s)
async function findRecentPng(dirPath, sinceTs, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        sftp.readdir(dirPath, (readErr, list) => {
          conn.end();
          if (readErr) return reject(readErr);
          const threshold = sinceTs - 5000; // 5s tolerance
          const candidates = list
            .filter(f => f.filename.endsWith('.png') && f.attrs.mtime * 1000 >= threshold)
            .sort((a, b) => b.attrs.mtime - a.attrs.mtime);
          if (candidates.length === 0) return resolve(null);
          const picked = candidates[0];
          return resolve({
            filename: picked.filename,
            fullPath: path.posix.join(dirPath, picked.filename),
            mtime: picked.attrs.mtime * 1000
          });
        });
      });
    }).on('error', (err) => reject(err))
      .connect(connectionDetails);
  });
}

// Helper function to build SLURM command
function buildSlurmCommand(originalCommand, clusterConfig) {
  const {
    partition = 'cpu',
    clusterName = 'bioinf', 
    nodes = '1',
    cpus = '24',
    memory = '64G',
    time = '06:00:00',
    ntasks = '1',
    threads = '1'
  } = clusterConfig;

  const slurmParams = [
    'srun',
    '--immediate',
    '--pty',
    `--partition=${partition}`,
    `--cluster=${clusterName}`,
    `--ntasks=${ntasks}`,
    `--nodes=${nodes}`,
    `--cpus-per-task=${cpus}`,
    `--threads-per-core=${threads}`,
    `--mem=${memory}`,
    `--time=${time}`,
    originalCommand
  ];

  return slurmParams.join(' ');
}

// Helper function to execute cluster command
async function executeClusterCommand(slurmCommand, connectionDetails) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    
    conn.on('ready', () => {
      console.log('[Cluster SSH] Connection established');
      
      conn.exec(slurmCommand, (err, stream) => {
        if (err) {
          conn.end();
          return reject(new Error(`SLURM execution failed: ${err.message}`));
        }
        
        let output = '';
        let errorOutput = '';
        
        stream.on('close', (code, signal) => {
          conn.end();
          console.log(`[Cluster Execution] Exit code: ${code}, Signal: ${signal || 'None'}`);
          
          if (code === 0) {
            resolve(output || 'Cluster job submitted successfully');
          } else {
            const error = errorOutput || output || `Job submission failed, exit code: ${code}`;
            reject(new Error(error));
          }
        });
        
        stream.on('data', (data) => {
          const decoded = iconv.decode(data, 'utf-8');
          output += decoded;
          console.log(`[Cluster Output] ${decoded}`);
        });
        
        stream.stderr.on('data', (data) => {
          const decoded = iconv.decode(data, 'utf-8');
          errorOutput += decoded;
          console.error(`[Cluster Error] ${decoded}`);
        });
      });
    });
    
    conn.on('error', (err) => {
      console.error('[Cluster SSH Error]', err);
      reject(new Error(`SSH connection failed: ${err.message}`));
    });
    
    conn.connect(connectionDetails);
  });
}

const PORT = process.env.PORT || 3010;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
