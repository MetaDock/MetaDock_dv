const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const toolsConfig = require('../../config/tools');
const adminConfig = require('../config/adminConfig');
const installerController = require('../controllers/installerController');

// Admin authentication middleware
const isAdmin = (req, res, next) => {
  // Check if SSH connection is established
  if (!req.app.locals.connectionDetails) {
    return res.redirect('/login');
  }
  // Check if user is admin
  if (!req.session.isAdmin) {
    return res.redirect('/login');
  }
  next();
};

// GET /data/tools_install.json -> 提供工具安装配置数据
router.get('/data/tools_install.json', isAdmin, (req, res) => {
    try {
        const toolsPath = path.join(__dirname, '..', 'data', 'tools_install.json');
        res.sendFile(toolsPath);
    } catch (error) {
        console.error('Error serving tools_install.json:', error);
        res.status(500).json({ error: 'Failed to load tools data' });
    }
});

// Admin login route
router.post('/login', async (req, res) => {
  console.log('Admin login attempt:', {
    body: req.body,
    hasConnection: !!req.app.locals.connectionDetails,
    session: req.session
  });

  try {
    // 检查是否已建立SSH连接
    if (!req.app.locals.connectionDetails) {
      console.log('SSH connection required');
      return res.status(401).json({ error: 'SSH connection required' });
    }

    const { username, password } = req.body;
    
    if (!username || !password) {
      console.log('Missing credentials');
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // TODO: Replace with proper admin authentication
    // For now, using hardcoded credentials
    if (username === 'admin' && password === 'admin123') {
      console.log('Admin login successful');
      req.session.isAdmin = true;
      return res.json({ success: true, redirect: '/admin' });
    } else {
      console.log('Invalid credentials');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Admin login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin logout route
router.get('/logout', (req, res) => {
  req.session.isAdmin = false;
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/login');
  });
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, adminConfig.paths.tempUploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: adminConfig.upload.maxFileSize
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (adminConfig.upload.allowedFileTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(adminConfig.errors.fileUpload.invalidType));
    }
  }
});

// GET / -> 显示首页 (Rectangle 1)
router.get('/', isAdmin, installerController.showHomePage);

// GET /search -> 显示搜索/推荐工具页 (Rectangle 2)
router.get('/search', isAdmin, installerController.showSearchPage);

// GET /options -> 显示选项页面
router.get('/options', isAdmin, (req, res) => {
    const selectedTools = req.session.selectedTools || [];
    res.render('option', {
        title: 'Download Options',
        selectedTools: selectedTools,
        connectionDetails: req.app.locals.connectionDetails,
        isAdmin: req.session.isAdmin
    });
});

// POST /options -> 处理从搜索页提交的表单，进入选项页 (Flow from 2 to 3)
router.post('/options', isAdmin, installerController.processSelectedTools);

// POST /install -> 处理从选项页提交的安装请求 (Flow from 3 to 8)
router.post('/install', isAdmin, installerController.startInstallation);

// GET /installing -> 显示安装过程页面
router.get('/installing', isAdmin, installerController.startInstallation);

// POST /installing -> 处理安装表单提交
router.post('/installing', isAdmin, (req, res) => {
    console.log('Received installation request:');
    console.log('Body:', req.body);
    console.log('installationConfig:', req.body.installationConfig);
    
    try {
        const installationConfig = JSON.parse(req.body.installationConfig);
        console.log('Parsed installation config:', installationConfig);
        
        res.render('installing', {
            title: 'Installation Progress',
            installationConfig: installationConfig,
            connectionDetails: req.app.locals.connectionDetails,
            isAdmin: req.session.isAdmin
        });
    } catch (error) {
        console.error('Error parsing installation config:', error);
        res.status(400).json({ error: 'Invalid installation configuration' });
    }
});

// Admin dashboard - protected by isAdmin middleware
router.get('/tool_management', isAdmin, (req, res) => {
  console.log('Rendering admin dashboard');
  res.locals.isAdmin = true;
  res.locals.connectionDetails = req.app.locals.connectionDetails;
  
  // Convert toolsConfig object to array of tools
  const tools = Object.entries(toolsConfig).map(([name, config]) => ({
    name,
    description: config.description || '',
    ...config
  }));
  
  res.render('admin-dashboard', { 
    toolsConfig,
    tools,
    title: 'Admin Dashboard'
  });
});

// Tool management page - protected by isAdmin middleware
router.get('/tools', isAdmin, (req, res) => {
  res.render('admin/tool-management');
});

// Upload help file and process
router.post('/upload-help', upload.single('helpFile'), async (req, res) => {
  try {
    const { toolName } = req.body;
    const helpFile = req.file;

    if (!helpFile) {
      return res.status(400).json({ error: adminConfig.errors.fileUpload.noFile });
    }

    console.log('Processing help file:', {
      toolName,
      originalName: helpFile.originalname,
      path: helpFile.path,
      size: helpFile.size
    });

    // Create output directories if they don't exist
    await fs.mkdir(adminConfig.paths.parametersDir, { recursive: true });
    await fs.mkdir(adminConfig.paths.helpDir, { recursive: true });
    await fs.mkdir(adminConfig.paths.tempUploadsDir, { recursive: true });

    // Move help file to help directory
    const helpPath = path.join(adminConfig.paths.helpDir, `${toolName}_help.txt`);
    await fs.rename(helpFile.path, helpPath);

    console.log('Help file moved to:', helpPath);

    // Process help file using Python scripts
    const paraOutputPath = path.join(adminConfig.paths.parametersDir, `${toolName}_para.json`);
    const usageOutputPath = path.join(adminConfig.paths.parametersDir, `${toolName}_usage.json`);

    console.log('Running param.py script...');
    // Run param.py script
    await new Promise((resolve, reject) => {
      const command = `python "${adminConfig.scripts.param}" "${helpPath}" "${paraOutputPath}" "${usageOutputPath}"`;
      console.log('Executing command:', command);
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('param.py error:', error);
          console.error('param.py stderr:', stderr);
          reject(new Error(adminConfig.errors.process.paramExtraction));
          return;
        }
        console.log('param.py stdout:', stdout);
        resolve(stdout);
      });
    });

    console.log('Running json_to_help.py script...');
    // Run json_to_help.py script
    const generatedHelpPath = path.join(adminConfig.paths.helpDir, `${toolName}_generated_help.txt`);
    await new Promise((resolve, reject) => {
      const command = `python "${adminConfig.scripts.jsonToHelp}" "${paraOutputPath}" "${usageOutputPath}" "${generatedHelpPath}"`;
      console.log('Executing command:', command);
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('json_to_help.py error:', error);
          console.error('json_to_help.py stderr:', stderr);
          reject(new Error(adminConfig.errors.process.jsonConversion));
          return;
        }
        console.log('json_to_help.py stdout:', stdout);
        resolve(stdout);
      });
    });

    console.log('Running compare_help_html.py script...');
    // Run compare_help_html.py script
    const comparisonOutputPath = path.join(adminConfig.paths.helpDir, `${toolName}_comparison.html`);
    await new Promise((resolve, reject) => {
      const command = `python "${adminConfig.scripts.compareHelp}" "${helpPath}" "${generatedHelpPath}" "${comparisonOutputPath}"`;
      console.log('Executing command:', command);
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error('compare_help_html.py error:', error);
          console.error('compare_help_html.py stderr:', stderr);
          reject(new Error(adminConfig.errors.process.comparison));
          return;
        }
        console.log('compare_help_html.py stdout:', stdout);
        resolve(stdout);
      });
    });

    // Update tools config
    const newTool = {
      title: `${toolName} Parameters`,
      toolName: toolName,
      route: toolName,
      commandRoute: `/run-command-${toolName}`,
      usagePath: `parameters/${toolName}_usage.json`,
      paraPath: `parameters/${toolName}_para.json`,
      html: adminConfig.tool.defaultHtml,
      selectionRoute: `/complete-selection-${toolName}`,
      env: adminConfig.tool.defaultEnv,
      hasStderr: adminConfig.tool.defaultHasStderr
    };

    // Add new tool to config
    toolsConfig[toolName] = newTool;

    // Save updated config
    await fs.writeFile(
      'config/tools.js',
      `module.exports = ${JSON.stringify(toolsConfig, null, 2)};`
    );

    res.json({
      success: true,
      message: adminConfig.messages.tool.added,
      comparisonUrl: `/help/${toolName}_comparison.html`
    });

  } catch (error) {
    console.error('Error processing help file:', error);
    res.status(500).json({ error: error.message || 'Failed to process help file' });
  }
});

// Delete tool
router.delete('/tools/:toolName', async (req, res) => {
  try {
    const { toolName } = req.params;

    if (!toolsConfig[toolName]) {
      return res.status(404).json({ error: adminConfig.errors.tool.notFound });
    }

    // Delete tool files
    const filesToDelete = [
      path.join(adminConfig.paths.helpDir, `${toolName}_help.txt`),
      path.join(adminConfig.paths.helpDir, `${toolName}_generated_help.txt`),
      path.join(adminConfig.paths.helpDir, `${toolName}_comparison.html`),
      path.join(adminConfig.paths.parametersDir, `${toolName}_para.json`),
      path.join(adminConfig.paths.parametersDir, `${toolName}_usage.json`)
    ];

    for (const file of filesToDelete) {
      try {
        await fs.unlink(file);
      } catch (err) {
        console.warn(`Warning: Could not delete file ${file}:`, err);
      }
    }

    // Remove tool from config
    delete toolsConfig[toolName];

    // Save updated config
    await fs.writeFile(
      'config/tools.js',
      `module.exports = ${JSON.stringify(toolsConfig, null, 2)};`
    );

    res.json({
      success: true,
      message: adminConfig.messages.tool.deleted
    });

  } catch (error) {
    console.error('Error deleting tool:', error);
    res.status(500).json({ error: 'Failed to delete tool' });
  }
});

// Get comparison results
router.get('/comparison/:toolName', (req, res) => {
  const { toolName } = req.params;
  const comparisonPath = path.join(adminConfig.paths.helpDir, `${toolName}_comparison.html`);
  res.sendFile(comparisonPath);
});

// Update tool
router.put('/tools/:toolName', async (req, res) => {
  try {
    const { toolName } = req.params;
    const { title, env, hasStderr } = req.body;

    if (!toolsConfig[toolName]) {
      return res.status(404).json({ error: adminConfig.errors.tool.notFound });
    }

    // Update tool config
    toolsConfig[toolName] = {
      ...toolsConfig[toolName],
      title,
      env,
      hasStderr
    };

    // Save updated config
    await fs.writeFile(
      'config/tools.js',
      `module.exports = ${JSON.stringify(toolsConfig, null, 2)};`
    );

    res.json({
      success: true,
      message: adminConfig.messages.tool.updated
    });

  } catch (error) {
    console.error('Error updating tool:', error);
    res.status(500).json({ error: 'Failed to update tool' });
  }
});

// Get parameter section
router.get('/tools/:toolName/parameters/:sectionId', isAdmin, async (req, res) => {
    try {
        const { toolName, sectionId } = req.params;
        const tool = toolsConfig[toolName];
        
        if (!tool) {
            return res.status(404).json({ error: 'Tool not found' });
        }

        // Read parameter and usage files
        const paraPath = path.join(__dirname, '..', '..', tool.paraPath);
        const usagePath = path.join(__dirname, '..', '..', tool.usagePath);
        
        let paraData = [];
        let usageData = [];

        try {
            const [paraContent, usageContent] = await Promise.all([
                fs.readFile(paraPath, 'utf8'),
                fs.readFile(usagePath, 'utf8')
            ]);
            
            paraData = JSON.parse(paraContent);
            const parsedUsageData = JSON.parse(usageContent);
            usageData = Array.isArray(parsedUsageData.usage) ? parsedUsageData.usage : [];
        } catch (error) {
            console.error('Error reading parameter files:', error);
            return res.status(500).json({ error: 'Failed to read parameter files' });
        }

        // Decode parameter ID
        const decodedSectionId = decodeURIComponent(sectionId);
        console.log('Looking for section:', decodedSectionId);

        // Find parameter using short or long field
        const section = paraData.find(s => {
            // Check short option
            if (s.short === decodedSectionId) return true;
            
            // Check long option
            if (s.long) {
                // Remove value part from long option (if exists)
                const longOpt = s.long.split(/\s+/)[0];
                return longOpt === decodedSectionId;
            }
            
            return false;
        });

        if (!section) {
            console.log('Available sections:', paraData.map(s => ({
                short: s.short,
                long: s.long
            })));
            return res.status(404).json({ error: 'Section not found' });
        }

        res.json(section);
    } catch (error) {
        console.error('Error retrieving section:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update parameter section
router.put('/tools/:toolName/parameters/:sectionId', isAdmin, async (req, res) => {
    const { toolName, sectionId } = req.params;
    const updatedSection = req.body;
    const tool = toolsConfig[toolName];
    
    if (!tool) {
        return res.status(404).json({ error: 'Tool not found' });
    }

    try {
        const paraPath = path.join(__dirname, '..', '..', tool.paraPath);
        const usagePath = path.join(__dirname, '..', '..', tool.usagePath);
        
        const [paraData, usageData] = await Promise.all([
            fs.readFile(paraPath, 'utf8').then(JSON.parse),
            fs.readFile(usagePath, 'utf8').then(JSON.parse)
        ]);

        // Decode parameter ID
        const decodedSectionId = decodeURIComponent(sectionId);
        console.log('Updating section:', decodedSectionId);

        // Find parameter using short or long field and update
        const paraIndex = paraData.findIndex(s => {
            // Check short option
            if (s.short === decodedSectionId) return true;
            
            // Check long option
            if (s.long) {
                // Remove value part from long option (if exists)
                const longOpt = s.long.split(/\s+/)[0];
                return longOpt === decodedSectionId;
            }
            
            return false;
        });

        if (paraIndex === -1) {
            console.log('Available sections:', paraData.map(s => ({
                short: s.short,
                long: s.long
            })));
            return res.status(404).json({ error: 'Section not found' });
        }

        // Update parameter data
        paraData[paraIndex] = { ...paraData[paraIndex], ...updatedSection };
        await fs.writeFile(paraPath, JSON.stringify(paraData, null, 2));

        // Regenerate help files
        await regenerateHelpFiles(toolName);

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating section:', error);
        res.status(500).json({ error: 'Failed to update section' });
    }
});

// Delete parameter section
router.delete('/tools/:toolName/parameters/:sectionId', isAdmin, async (req, res) => {
  const { toolName, sectionId } = req.params;
  const tool = toolsConfig[toolName];
  
  if (!tool) {
    return res.status(404).json({ error: 'Tool not found' });
  }

  try {
    const paraPath = path.join(__dirname, '..', '..', tool.paraPath);
    const usagePath = path.join(__dirname, '..', '..', tool.usagePath);
    
    const [paraData, usageData] = await Promise.all([
      fs.readFile(paraPath, 'utf8').then(JSON.parse),
      fs.readFile(usagePath, 'utf8').then(JSON.parse)
    ]);

    // Find parameter using short or long field and delete
    const paraIndex = paraData.findIndex(s => s.short === sectionId || s.long === sectionId);

    if (paraIndex !== -1) {
      paraData.splice(paraIndex, 1);
      await fs.writeFile(paraPath, JSON.stringify(paraData, null, 2));
    } else {
      return res.status(404).json({ error: 'Section not found' });
    }

    // Regenerate help files
    await regenerateHelpFiles(toolName);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting section:', error);
    res.status(500).json({ error: 'Failed to delete section' });
  }
});

// Add new parameter section
router.post('/tools/:toolName/parameters', isAdmin, async (req, res) => {
  const { toolName } = req.params;
  const newSection = req.body;
  const tool = toolsConfig[toolName];
  
  if (!tool) {
    return res.status(404).json({ error: 'Tool not found' });
  }

  try {
    // Read existing parameter files
    const paraPath = path.join(__dirname, '..', '..', tool.paraPath);
    const paraData = await fs.readFile(paraPath, 'utf8').then(JSON.parse);

    // Add new parameter, without id field
    paraData.push({
      category: newSection.category,
      short: newSection.short,
      long: newSection.long,
      needs_input: newSection.needs_input,
      description: newSection.description
    });

    // Save updated data
    await fs.writeFile(paraPath, JSON.stringify(paraData, null, 4));

    // Regenerate help files
    const helpDir = path.join(__dirname, '..', '..', 'help');
    const generatedHelpFile = path.join(helpDir, `${toolName}_generated_help.txt`);
    const helpFile = path.join(helpDir, `${toolName}_help.txt`);
    const tempOutputFile = path.join(__dirname, '..', '..', 'temp', `${toolName}_comparison.html`);

    // Call Python script to generate help file
    const scriptPath = path.join(__dirname, '..', 'scripts', 'json_to_help.py');
    await execAsync(`python "${scriptPath}" "${paraPath}" "${path.join(__dirname, '..', '..', tool.usagePath)}" "${generatedHelpFile}"`);

    // Generate comparison result
    const compareScriptPath = path.join(__dirname, '..', 'scripts', 'compare_help_html.py');
    await execAsync(`python "${compareScriptPath}" "${helpFile}" "${generatedHelpFile}" "${tempOutputFile}"`);

    // Read comparison result
    const comparisonResult = await fs.readFile(tempOutputFile, 'utf8');

    // Delete temporary file
    await fs.unlink(tempOutputFile);

    // Return successful response and new comparison result
    res.json({
      success: true,
      section: newSection,
      comparisonResult: comparisonResult
    });
  } catch (error) {
    console.error('Error adding section:', error);
    res.status(500).json({ error: 'Failed to add section' });
  }
});

// Comparison page route
router.get('/tools/:toolName/comparison', isAdmin, async (req, res) => {
  try {
    const toolName = req.params.toolName;
    const helpFile = path.join(__dirname, '..', '..', 'help', `${toolName}_help.txt`);
    const generatedHelpFile = path.join(__dirname, '..', '..', 'help', `${toolName}_generated_help.txt`);
    const tempOutputFile = path.join(__dirname, '..', '..', 'temp', `${toolName}_comparison.html`);

    // Run the comparison script
    const scriptPath = path.join(__dirname, '..', 'scripts', 'compare_help_html.py');
    await execAsync(`python "${scriptPath}" "${helpFile}" "${generatedHelpFile}" "${tempOutputFile}"`);

    // Read the comparison result
    const comparisonResult = await fs.readFile(tempOutputFile, 'utf8');

    // Delete temporary file
    await fs.unlink(tempOutputFile);

    // Render the comparison page using the template
    res.render('comparison', {
      toolName: toolName,
      comparisonResult: comparisonResult,
      timestamp: new Date().toLocaleString()
    });
  } catch (error) {
    console.error('Error generating comparison:', error);
    res.status(500).send('Error generating comparison');
  }
});

// Edit tool
router.get('/tools/:toolName/edit', isAdmin, async (req, res) => {
  try {
    const { toolName } = req.params;
    
    if (!toolsConfig[toolName]) {
      return res.status(404).json({ error: adminConfig.errors.tool.notFound });
    }

    // Read parameter files
    const paraPath = path.join(adminConfig.paths.parametersDir, `${toolName}_para.json`);
    const usagePath = path.join(adminConfig.paths.parametersDir, `${toolName}_usage.json`);

    let paraData = [];
    let usageData = [];

    try {
      const [paraContent, usageContent] = await Promise.all([
        fs.readFile(paraPath, 'utf8'),
        fs.readFile(usagePath, 'utf8')
      ]);
      
      // Parse parameter data
      const parsedParaData = JSON.parse(paraContent);
      paraData = Array.isArray(parsedParaData) ? parsedParaData : [];

      // Parse usage data and extract the usage array
      const parsedUsageData = JSON.parse(usageContent);
      usageData = parsedUsageData.usage || [];

      // Convert usage strings to objects with id and description
      usageData = usageData.map((usage, index) => ({
        id: `usage_${index}`,
        description: usage
      }));
    } catch (error) {
      console.warn('Error reading parameter files:', error);
      // If files don't exist or are invalid, use empty arrays
      paraData = [];
      usageData = [];
    }

    res.render('tool-edit', {
      title: `Edit ${toolName}`,
      toolName,
      tool: toolsConfig[toolName],
      paraData,
      usageData
    });
  } catch (error) {
    console.error('Error loading edit page:', error);
    res.status(500).json({ error: 'Failed to load edit page' });
  }
});

// Preview parameter section
router.post('/tools/:toolName/preview', async (req, res) => {
    try {
        const { toolName } = req.params;
        const tool = toolsConfig[toolName];
        if (!tool) {
            return res.status(404).json({ error: 'Tool not found' });
        }

        // Create temporary directory
        const tempDir = path.join(__dirname, '..', '..', 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        // Create temporary files
        const tempParaFile = path.join(tempDir, `${toolName}_temp_para.json`);
        const tempUsageFile = path.join(tempDir, `${toolName}_temp_usage.json`);
        const tempOutputFile = path.join(tempDir, `${toolName}_temp_output.txt`);

        // Prepare parameter data
        const paraData = [{
            category: req.body.category || "",
            short: req.body.short || "",
            long: req.body.long || "",
            needs_input: req.body.needs_input === 'on' || req.body.needs_input === true,
            description: req.body.description || ""
        }];

        // Prepare usage data
        const usageData = {
            usage: [
                `usage: ${toolName} [${req.body.long || ''}] ${req.body.needs_input ? 'VALUE' : ''}`
            ]
        };

        // Write temporary files
        await fs.writeFile(tempParaFile, JSON.stringify(paraData, null, 4));
        await fs.writeFile(tempUsageFile, JSON.stringify(usageData, null, 4));

        // Return JSON formatted preview data
        res.json({
            parameter: paraData[0],
            usage: usageData.usage[0]
        });
    } catch (error) {
        console.error('Preview generation error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper function: Regenerate help files
async function regenerateHelpFiles(toolName) {
  const tool = toolsConfig[toolName];
  if (!tool) return;

  try {
    const paraPath = path.join(__dirname, '..', '..', tool.paraPath);
    const usagePath = path.join(__dirname, '..', '..', tool.usagePath);
    const helpDir = path.join(__dirname, '..', '..', 'help');
    const generatedHelpFile = path.join(helpDir, `${toolName}_generated_help.txt`);

    // Call Python script to generate help file
    const scriptPath = path.join(__dirname, '..', 'scripts', 'json_to_help.py');
    await promisify(exec)(`python "${scriptPath}" "${paraPath}" "${usagePath}" "${generatedHelpFile}"`);

    // Generate comparison result
    const helpFile = path.join(helpDir, `${toolName}_help.txt`);
    const outputFile = path.join(helpDir, `${toolName}_comparison.html`);
    const compareScriptPath = path.join(__dirname, '..', 'scripts', 'compare_help_html.py');
    await promisify(exec)(`python "${compareScriptPath}" "${helpFile}" "${generatedHelpFile}" "${outputFile}"`);
  } catch (error) {
    console.error('Error regenerating help files:', error);
    throw error;
  }
}

// Delete parameter
router.delete('/tools/:toolName/parameters/:option', async (req, res) => {
    try {
        const { toolName, option } = req.params;
        const toolConfig = toolsConfig[toolName];
        if (!toolConfig) {
            return res.status(404).json({ error: 'Tool not found' });
        }

        const paraPath = path.join(__dirname, '..', '..', toolConfig.paraPath);
        const paraData = JSON.parse(fs.readFileSync(paraPath, 'utf8'));

        // Find and delete parameter
        const index = paraData.findIndex(section => 
            section.short === option || section.long === option
        );

        if (index === -1) {
            return res.status(404).json({ error: 'Section not found' });
        }

        paraData.splice(index, 1);
        fs.writeFileSync(paraPath, JSON.stringify(paraData, null, 2));

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting section:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete category
router.delete('/tools/:toolName/parameters/category/:category', async (req, res) => {
    try {
        const { toolName, category } = req.params;
        const toolConfig = toolsConfig[toolName];
        if (!toolConfig) {
            return res.status(404).json({ error: 'Tool not found' });
        }

        const paraPath = path.join(__dirname, '..', '..', toolConfig.paraPath);
        const paraData = JSON.parse(await fs.readFile(paraPath, 'utf8'));

        // Find and delete all parameters in the category
        const filteredData = paraData.filter(section => section.category !== category);
        
        // If all parameters are deleted, return empty array
        if (filteredData.length === 0) {
            await fs.writeFile(paraPath, '[]');
        } else {
            await fs.writeFile(paraPath, JSON.stringify(filteredData, null, 2));
        }

        // Regenerate help files
        await regenerateHelpFiles(toolName);

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ error: error.message });
    }
});

// Usage management routes
router.get('/tools/:toolName/usage', async (req, res) => {
    try {
        const { toolName } = req.params;
        const usageFile = path.join(__dirname, '../../parameters', `${toolName}_usage.json`);
        
        try {
            const usageData = JSON.parse(await fs.readFile(usageFile, 'utf8'));
            res.json(usageData);
        } catch (error) {
            // If file doesn't exist or can't be read, return empty array
            if (error.code === 'ENOENT') {
                return res.json({ usage: [] });
            }
            throw error;
        }
    } catch (error) {
        console.error('Error reading usage file:', error);
        res.status(500).json({ error: 'Failed to read usage file' });
    }
});

router.put('/tools/:toolName/usage', async (req, res) => {
    try {
        const { toolName } = req.params;
        const { usage } = req.body;
        
        if (!usage || !Array.isArray(usage)) {
            return res.status(400).json({ error: 'Invalid usage data' });
        }
        
        const usageFile = path.join(__dirname, '../../parameters', `${toolName}_usage.json`);
        await fs.writeFile(usageFile, JSON.stringify({ usage }, null, 4));
        
        // Regenerate help files
        await regenerateHelpFiles(toolName);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating usage file:', error);
        res.status(500).json({ error: 'Failed to update usage file' });
    }
});

router.delete('/tools/:toolName/usage/:index', async (req, res) => {
    try {
        const { toolName, index } = req.params;
        const usageFile = path.join(__dirname, '../../parameters', `${toolName}_usage.json`);
        
        try {
            const usageData = JSON.parse(await fs.readFile(usageFile, 'utf8'));
            const usageIndex = parseInt(index);
            
            if (isNaN(usageIndex) || usageIndex < 0 || usageIndex >= usageData.usage.length) {
                return res.status(400).json({ error: 'Invalid usage index' });
            }
            
            // Delete specified usage
            usageData.usage.splice(usageIndex, 1);
            
            // If no usage left, delete file
            if (usageData.usage.length === 0) {
                await fs.unlink(usageFile);
            } else {
                await fs.writeFile(usageFile, JSON.stringify(usageData, null, 4));
            }
            
            // Regenerate help files
            await regenerateHelpFiles(toolName);
            
            res.json({ success: true });
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'Usage file not found' });
            }
            throw error;
        }
    } catch (error) {
        console.error('Error deleting usage:', error);
        res.status(500).json({ error: 'Failed to delete usage' });
    }
});

router.post('/tools/:toolName/usage/preview', async (req, res) => {
    try {
        const { toolName } = req.params;
        const { usage } = req.body;

        if (!usage) {
            return res.status(400).json({ error: 'Usage content is required' });
        }

        // Return the usage in the expected format
        res.json({ usage: [usage] });
    } catch (error) {
        console.error('Error generating preview:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router; 