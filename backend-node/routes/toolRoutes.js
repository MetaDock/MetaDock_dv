/**
 * Tool and visualization routes: dynamic tool pages, visualization, /api/tools, /api/tool-config, search-tools
 */
const path = require('path');
const fs = require('fs').promises;

function registerToolRoutes(app, appConfig, toolsConfig, visualizationConfig, commandHandler, checkConnection, sshHelpers) {
  app.get('/search-tools', (req, res) => {
    const query = (req.query.query || '').toLowerCase();
    if (!query) return res.json([]);
    const matching = Object.values(toolsConfig).filter(tool => {
      const name = (tool.toolName || '').toLowerCase();
      const desc = (tool.description || '').toLowerCase();
      const route = (tool.route || '').toLowerCase();
      return name.includes(query) || desc.includes(query) || route.includes(query);
    });
    res.json(matching);
  });

  Object.values(toolsConfig).forEach(tool => {
    app.get(`/${tool.route.toLowerCase()}`, checkConnection, (req, res) => {
      res.render(tool.html, { title: tool.title, toolName: tool.toolName, commandRoute: tool.commandRoute });
    });
    app.post(tool.commandRoute, commandHandler(tool));
    app.post(`${tool.commandRoute}/cluster`, async (req, res) => {
      if (!req.app.locals.connectionDetails) {
        return res.status(400).json({ error: 'Connection details not provided.' });
      }
      const { command, clusterConfig } = req.body;
      try {
        const slurmCommand = sshHelpers.buildSlurmCommand(command, clusterConfig);
        const output = await sshHelpers.executeClusterCommand(slurmCommand, req.app.locals.connectionDetails);
        res.json({ output, slurmCommand, message: 'Cluster job submitted successfully' });
      } catch (error) {
        res.status(500).json({ error: 'Cluster execution failed', details: error.message });
      }
    });
    app.get(`/get_${path.basename(tool.usagePath, '_usage.json')}_usage`, (req, res) => {
      res.sendFile(path.join(appConfig.paths.parameters, path.basename(tool.usagePath)));
    });
    app.get(`/get_${path.basename(tool.paraPath, '_para.json')}_para`, (req, res) => {
      res.sendFile(path.join(appConfig.paths.parameters, path.basename(tool.paraPath)));
    });
    app.get(tool.selectionRoute, async (req, res) => {
      const selectedFiles = req.query.files || '';
      try {
        const data = await fs.readFile(path.join(appConfig.paths.frontendPublic, 'views', tool.html), 'utf8');
        const updated = data.replace(
          '<input type="text" id="file-input" placeholder="Selected files">',
          `<input type="text" id="file-input" value="${selectedFiles}" placeholder="Selected files">`
        );
        res.type('html').send(updated);
      } catch (err) {
        res.status(500).send('Error loading the page');
      }
    });
  });

  Object.values(visualizationConfig).forEach(viz => {
    app.get(`/${viz.route.toLowerCase()}`, checkConnection, (req, res) => {
      res.render(viz.html, {
        title: viz.title,
        toolName: viz.toolName,
        icon: viz.icon,
        visualizationPath: viz.visualizationPath
      });
    });
  });

  app.get('/visualization-tools', (req, res) => {
    const visualizations = Object.values(visualizationConfig).map(v => ({ title: v.title, toolName: v.toolName, route: v.route, icon: v.icon }));
    res.json(visualizations);
  });

  app.get('/visualization/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(appConfig.paths.frontendPublic, 'visualization', filename);
    if (!require('fs').existsSync(filePath)) return res.status(404).send('File not found');
    res.sendFile(filePath);
  });

  app.get('/workflow', checkConnection, (req, res) => {
    res.render('workflow', { workingDir: appConfig.workingDir });
  });

  app.get('/workflow-mock', checkConnection, (req, res) => {
    res.render('workflow-mock', { workingDir: appConfig.workingDir });
  });

  app.get('/api/tools', (req, res) => {
    const tools = Object.values(toolsConfig).map(t => ({
      route: t.route,
      title: t.title,
      toolName: t.toolName,
      html: t.html,
      paraPath: t.paraPath,
      usagePath: t.usagePath,
      commandRoute: t.commandRoute,
      selectionRoute: t.selectionRoute
    }));
    res.json(tools);
  });

  app.get('/api/visualization-tools', (req, res) => {
    const list = Object.values(visualizationConfig).map(v => ({ title: v.title, toolName: v.toolName, route: v.route, icon: v.icon }));
    res.json(list);
  });

  app.get('/api/tool-config/:toolName', async (req, res) => {
    const toolName = req.params.toolName;
    const tool = Object.values(toolsConfig).find(t => t.toolName === toolName || t.route === toolName);
    if (!tool) return res.status(404).json({ error: 'Tool not found' });
    try {
      const paraPath = path.join(appConfig.paths.parameters, path.basename(tool.paraPath));
      const usagePath = path.join(appConfig.paths.parameters, path.basename(tool.usagePath));
      const para = JSON.parse(await fs.readFile(paraPath, 'utf8'));
      const usage = JSON.parse(await fs.readFile(usagePath, 'utf8'));
      res.json({ toolName: tool.toolName, para, usage });
    } catch (err) {
      res.status(500).json({ error: 'Failed to load tool config' });
    }
  });
}

module.exports = { registerToolRoutes };
