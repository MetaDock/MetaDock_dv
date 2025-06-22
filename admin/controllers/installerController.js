// controllers/installerController.js
const toolService = require('../services/toolService');
const InstallationService = require('../services/installationService');

// 1. home page
exports.showHomePage = (req, res) => {
    const pageData = {
        title: 'Installer Home',
        connectionDetails: req.app.locals.connectionDetails,
        isAdmin: req.session.isAdmin || false
    };
    res.render('index', pageData);
};

// 2. show search/recommend tool page
exports.showSearchPage = (req, res) => {
    const recommendedTools = toolService.findRecommended();
    res.render('select', {
        title: 'Search Tools',
        recommendedTools: recommendedTools,
        connectionDetails: req.app.locals.connectionDetails,
        isAdmin: req.session.isAdmin
    });
};

// 3. process selected tools and show option page
exports.processSelectedTools = (req, res) => {
    try {
        // parse tool IDs from JSON string
        const selectedIds = JSON.parse(req.body.toolIds || '[]');
        console.log('Selected tool IDs:', selectedIds); 

        // get tool information
        const tools = toolService.findByIds(selectedIds);
        console.log('Found tools:', tools); 

        // save selected tools to session for installation step
        req.session.selectedTools = tools;

        res.render('option', {
            title: 'Download Options',
            selectedTools: tools,
            connectionDetails: req.app.locals.connectionDetails,
            isAdmin: req.session.isAdmin
        });
    } catch (error) {
        console.error('Error processing selected tools:', error);
        res.status(400).render('select', {
            title: 'Search Tools',
            recommendedTools: toolService.findRecommended(),
            connectionDetails: req.app.locals.connectionDetails,
            isAdmin: req.session.isAdmin,
            error: 'Failed to process selected tools. Please try again.'
        });
    }
};

// 4. start installation and show installation process page
exports.startInstallation = async (req, res) => {
    try {
        const installationConfig = req.body;
        console.log('Received installation config:', installationConfig);
        
        // parse installation config
        let config;
        if (typeof installationConfig === 'string') {
            config = JSON.parse(installationConfig);
        } else if (installationConfig.installationConfig) {
            config = JSON.parse(installationConfig.installationConfig);
        } else {
            config = installationConfig;
        }

        // get admin settings
        const adminSettings = {
            condaEnvPath: req.body.condaEnvPath || null,
            gitInstallPath: req.body.gitInstallPath || null
        };

        // create installation service instance
        const installationService = new InstallationService(req.app.locals.connectionDetails);

        // validate installation config
        const validation = await installationService.validateInstallationConfig(config, adminSettings);
        
        if (!validation.valid) {
            console.log('Installation validation failed:', validation.errors);
            return res.render('option', {
                title: 'Download Options',
                selectedTools: req.session.selectedTools || [],
                connectionDetails: req.app.locals.connectionDetails,
                isAdmin: req.session.isAdmin,
                validationErrors: validation.errors,
                validationWarnings: validation.warnings,
                condaCheck: validation.condaCheck,
                environmentCheck: validation.environmentCheck,
                pathChecks: validation.pathChecks
            });
        }

        // if validation passed, render installation page
        res.render('installing', {
            title: 'Installing...',
            config: config,
            adminSettings: adminSettings,
            connectionDetails: req.app.locals.connectionDetails,
            isAdmin: req.session.isAdmin
        });
    } catch (error) {
        console.error('Error in startInstallation:', error);
        res.status(500).render('option', {
            title: 'Download Options',
            selectedTools: req.session.selectedTools || [],
            connectionDetails: req.app.locals.connectionDetails,
            isAdmin: req.session.isAdmin,
            error: 'Failed to start installation. Please try again.'
        });
    }
};

// 5. execute installation API endpoint
exports.executeInstallation = async (req, res) => {
    try {
        const { config, adminSettings } = req.body;
        
        // create installation service instance
        const installationService = new InstallationService(req.app.locals.connectionDetails);
        
        // execute installation
        const results = await installationService.executeInstallation(
            config, 
            adminSettings,
            (message, type) => {
                console.log(`[${type}] ${message}`);
            }
        );
        
        res.json({
            success: true,
            results: results
        });
    } catch (error) {
        console.error('Error executing installation:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

// 6. check system environment API endpoint
exports.checkSystemEnvironment = async (req, res) => {
    console.log('checkSystemEnvironment called');
    console.log('Request headers:', req.headers);
    console.log('Request method:', req.method);
    console.log('Request URL:', req.url);
    
    try {
        console.log('Creating InstallationService instance...');
        const installationService = new InstallationService(req.app.locals.connectionDetails);
        
        console.log('Checking conda installation...');
        const condaCheck = await installationService.checkCondaInstallation();
        console.log('Conda check result:', condaCheck);
        
        console.log('Checking conda environment...');
        const environmentCheck = await installationService.checkCondaEnvironment();
        console.log('Environment check result:', environmentCheck);
        
        console.log('Checking install path...');
        const pathCheck = await installationService.checkInstallPath();
        console.log('Path check result:', pathCheck);
        
        // get system information
        const os = require('os');
        const path = require('path');
        
        const systemInfo = {
            platform: os.platform(),
            arch: os.arch(),
            release: os.release(),
            hostname: os.hostname(),
            cwd: process.cwd(),
            homeDir: os.homedir(),
            tmpDir: os.tmpdir()
        };
        
        console.log('System info:', systemInfo);
        
        const response = {
            conda: condaCheck,
            environment: environmentCheck,
            paths: {
                git: pathCheck
            },
            system: systemInfo
        };
        
        console.log('Sending response:', response);
        res.json(response);
    } catch (error) {
        console.error('Error in checkSystemEnvironment:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
};