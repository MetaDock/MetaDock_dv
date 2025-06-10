// controllers/installerController.js
const toolService = require('../services/toolService');

// 1. 显示首页 (Rectangle 1)
exports.showHomePage = (req, res) => {
    // 假设你的 navbar.ejs 需要这些数据
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
exports.startInstallation = (req, res) => {
    // 前端拖拽后，需要通过一个隐藏的表单或JS来提交最终的安装配置。
    // 例如，每个drop-zone里有一个 <input type="hidden" name="anaconda" value="cutadapt,metaphlan">
    const installationConfig = req.body;
    console.log('Received installation config:', installationConfig);
    
    // 这里的 `installationConfig` 大概是这样的:
    // { anaconda: 'cutadapt,metaphlan', pip: '', git: 'some_other_tool' }
    
    // 在真实应用中，你会调用一个服务来执行安装。
    // installationService.execute(installationConfig);
    // 这个服务会使用子进程 (child_process) 来执行真实的 shell 命令。
    // 并且通过 WebSocket (如 Socket.IO) 将实时日志推送到前端。

    // 为了简化，我们直接渲染最终页面，并传入配置用于显示。
    res.render('installing', {
        title: 'Installing...',
        config: installationConfig,
        connectionDetails: req.app.locals.connectionDetails,
        isAdmin: req.session.isAdmin
    });
};