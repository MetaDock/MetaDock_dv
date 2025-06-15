// controllers/installerController.js
const toolService = require('../services/toolService');
const InstallationService = require('../services/installationService');

// 1. 显示首页 (Rectangle 1)
exports.showHomePage = (req, res) => {
    const pageData = {
        title: 'Installer Home',
        connectionDetails: req.app.locals.connectionDetails,
        isAdmin: req.session.isAdmin || false
    };
    res.render('index', pageData);
};

// 2. 显示搜索/推荐工具页面 (Rectangle 2)
exports.showSearchPage = (req, res) => {
    const recommendedTools = toolService.findRecommended();
    res.render('select', {
        title: 'Search Tools',
        recommendedTools: recommendedTools,
        connectionDetails: req.app.locals.connectionDetails,
        isAdmin: req.session.isAdmin
    });
};

// 3. 处理选择的工具并显示选项页面 (Flow from 2 to 3)
exports.processSelectedTools = (req, res) => {
    try {
        // 解析 JSON 字符串形式的工具 ID
        const selectedIds = JSON.parse(req.body.toolIds || '[]');
        console.log('Selected tool IDs:', selectedIds); // 调试日志

        // 获取工具信息
        const tools = toolService.findByIds(selectedIds);
        console.log('Found tools:', tools); // 调试日志

        // 将用户选择的工具存入 session，以便在安装步骤使用
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

// 4. 开始安装并显示安装过程页面 (Flow from 3 to 8)
exports.startInstallation = async (req, res) => {
    try {
        const installationConfig = req.body;
        console.log('Received installation config:', installationConfig);
        
        // 解析安装配置
        let config;
        if (typeof installationConfig === 'string') {
            config = JSON.parse(installationConfig);
        } else if (installationConfig.installationConfig) {
            config = JSON.parse(installationConfig.installationConfig);
        } else {
            config = installationConfig;
        }

        // 获取管理员设置
        const adminSettings = {
            condaEnvPath: req.body.condaEnvPath || null,
            gitInstallPath: req.body.gitInstallPath || null
        };

        // 创建安装服务实例
        const installationService = new InstallationService(req.app.locals.connectionDetails);

        // 验证安装配置
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

        // 如果验证通过，渲染安装页面
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

// 5. 执行安装API端点
exports.executeInstallation = async (req, res) => {
    try {
        const { config, adminSettings } = req.body;
        
        // 创建安装服务实例
        const installationService = new InstallationService(req.app.locals.connectionDetails);
        
        // 执行安装
        const results = await installationService.executeInstallation(
            config, 
            adminSettings,
            (message, type) => {
                // 这里可以实现实时日志推送
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

// 6. 检查系统环境API端点
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
        
        // 获取系统信息
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