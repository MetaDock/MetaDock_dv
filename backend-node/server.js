// Load environment variables from .env file
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const appConfig = require('./config/index.js');
const projectRoot = appConfig.projectRoot;

const express = require('express');
const { exec } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs').promises;
const fsSync = require('fs');
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

const { checkConnection, checkConnectionAPI, requestLogger } = require('./middleware');
const { startAgent } = require('./lib/agentRunner');
const sshHelpers = require('./lib/sshHelpers');
const { registerPageRoutes } = require('./routes/pageRoutes');
const { registerAuthRoutes } = require('./routes/authRoutes');
const { registerFileRoutes } = require('./routes/fileRoutes');
const { registerToolRoutes } = require('./routes/toolRoutes');
const { registerCondaRoutes } = require('./routes/condaRoutes');
const { registerWorkflowRoutes } = require('./routes/workflowRoutes');
const { registerAgentRoutes } = require('./routes/agentRoutes');
const { registerVizRoutes } = require('./routes/vizRoutes');

const app = express();

// Agent state
app.locals.isAgentReady = false;

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const tempDir = appConfig.paths.tempUploads;
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

app.use(requestLogger);

// Basic middleware configuration
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

startAgent(app, appConfig);

// Session configuration
app.use(session({
  secret: appConfig.sessionSecret,
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
  appConfig.paths.frontendViews
]);

// Serve static files
app.use(express.static(appConfig.paths.frontendPublic));

// Add middleware to pass connectionDetails to all routes
app.use((req, res, next) => {
  res.locals.connectionDetails = req.app.locals.connectionDetails;
  next();
});

registerPageRoutes(app, toolsConfig, checkConnection);
app.use('/admin', adminRoutes);

registerAuthRoutes(app, upload);
registerToolRoutes(app, appConfig, toolsConfig, visualizationConfig, commandHandler, checkConnection, sshHelpers);
registerFileRoutes(app, appConfig, upload, checkConnection, sshHelpers);
registerCondaRoutes(app, checkConnectionAPI);
registerWorkflowRoutes(app, appConfig, checkConnectionAPI, checkConnection, toolsConfig);
registerAgentRoutes(app);
registerVizRoutes(app, appConfig, checkConnectionAPI);
app.use('/visualization', express.static(path.join(appConfig.paths.frontendPublic, 'visualization')));

const PORT = appConfig.port;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://localhost:${PORT}`));
