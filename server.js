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

const app = express();

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

const PORT = process.env.PORT || 3010;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
