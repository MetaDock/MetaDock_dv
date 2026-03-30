/**
 * Workflow routes: run-generic-workflow, workflow-status, workflow-jobs,
 * run-real-spades-quast, run-mock-spades-quast, run-workflow, kg/workflows/add
 */
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { Client } = require('ssh2');
const axios = require('axios');
const workflowExecution = require('../services/workflowExecution');

const workflowJobs = new Map();

function registerWorkflowRoutes(app, appConfig, checkConnectionAPI, checkConnection, toolsConfig = {}) {
  app.post('/api/run-generic-workflow', checkConnectionAPI, async (req, res) => {
    let executionResults = {};
    try {
      const { workflow, executionPlan, commands, workingDir } = req.body;
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(400).json({ error: 'No connection details available' });
      const jobId = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      executionResults = {
        jobId, status: 'running', steps: [], startTime: new Date().toISOString(),
        workingDir, workflow, executionPlan, commands, progress: 0, currentStep: null
      };
      workflowJobs.set(jobId, executionResults);
      res.json({ success: true, message: 'Workflow started in background', jobId, status: 'running' });

      const conn = new Client();
      conn.on('ready', () => {
        function executeNextCommand(stepIndex) {
          if (stepIndex >= commands.length) {
            executionResults.endTime = new Date().toISOString();
            executionResults.totalSteps = commands.length;
            executionResults.successfulSteps = executionResults.steps.filter(s => s.exitCode === 0).length;
            executionResults.progress = 100;
            executionResults.currentStep = null;
            executionResults.status = executionResults.successfulSteps === executionResults.totalSteps ? 'completed' : 'failed';
            executionResults.message = executionResults.status === 'completed' ? `Generic workflow completed! Executed ${executionResults.totalSteps} tools.` : `Workflow completed with ${executionResults.successfulSteps}/${executionResults.totalSteps} steps.`;
            workflowJobs.set(jobId, executionResults);
            conn.end();
            return;
          }
          const currentCommand = commands[stepIndex];
          const condaEnv = toolsConfig[currentCommand.component]?.conda_env || toolsConfig[currentCommand.component]?.env || currentCommand.condaEnv || 'base';
          executionResults.progress = Math.round((stepIndex / commands.length) * 100);
          executionResults.currentStep = currentCommand.component;
          workflowJobs.set(jobId, executionResults);
          let fullCommand = `source ~/.bashrc 2>/dev/null || true && cd ${workingDir} && echo "=== Executing ${currentCommand.component} ===" && `;
          if (currentCommand.component === 'spades') {
            fullCommand += `[ ! -f left.fastq.gz ] && printf "@read1\\nACGTACGTACGT\\n+\\nIIIIIIIIIIII\\n" | gzip > left.fastq.gz || true && [ ! -f right.fastq.gz ] && printf "@read2\\nTGCATGCATGCA\\n+\\nIIIIIIIIIIII\\n" | gzip > right.fastq.gz || true && `;
          }
          fullCommand += `export PATH="${appConfig.condaPath}/bin:$PATH" && eval "$(${appConfig.condaPath}/bin/conda shell.bash hook)" && conda env list | grep -q "^${condaEnv}\\s" || (echo "ERROR: env not found" && exit 1) && conda activate ${condaEnv} && which ${currentCommand.component}.py || (echo "ERROR: tool not found" && exit 1) && ${currentCommand.command}`;
          conn.exec(fullCommand, (err, stream) => {
            if (err) {
              executionResults.steps.push({ tool: currentCommand.component, nodeId: currentCommand.nodeId, command: fullCommand, exitCode: -1, output: '', error: err.message, timestamp: new Date().toISOString() });
              executeNextCommand(stepIndex + 1);
              return;
            }
            let output = '', error = '';
            stream.on('close', (code) => {
              executionResults.steps.push({ tool: currentCommand.component, nodeId: currentCommand.nodeId, command: fullCommand, exitCode: code, output, error, timestamp: new Date().toISOString() });
              executeNextCommand(stepIndex + 1);
            });
            stream.on('data', (d) => { output += d.toString(); });
            stream.stderr.on('data', (d) => { error += d.toString(); });
          });
        }
        executeNextCommand(0);
      });
      conn.on('error', (err) => res.status(500).json({ error: 'SSH connection failed', details: err.message }));
      conn.connect(connectionDetails);
    } catch (error) {
      if (executionResults.jobId) {
        executionResults.status = 'failed';
        executionResults.error = error.message;
        workflowJobs.set(executionResults.jobId, executionResults);
      }
      res.status(500).json({ error: 'Failed to run generic workflow', details: error.message });
    }
  });

  app.get('/api/workflow-status/:jobId', checkConnectionAPI, (req, res) => {
    const { jobId } = req.params;
    if (!workflowJobs.has(jobId)) return res.status(404).json({ error: 'Workflow job not found' });
    res.json(workflowJobs.get(jobId));
  });

  app.get('/api/workflow-jobs', checkConnectionAPI, (req, res) => {
    const jobs = Array.from(workflowJobs.entries()).map(([id, job]) => ({ ...job, jobId: id }));
    res.json(jobs);
  });

  // Real SPAdes + QUAST workflow
  app.post('/api/run-real-spades-quast', checkConnectionAPI, async (req, res) => {
    try {
      const { workingDir, spadesEnv, quastEnv, spadesCommand, quastCommand, workflow } = req.body;
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(400).json({ error: 'No connection details available' });
      const executionResults = { steps: [], startTime: new Date().toISOString(), workingDir, environments: { spadesEnv, quastEnv }, commands: { spadesCommand, quastCommand }, workflow };
      const conn = new Client();
      conn.on('ready', () => {
        const runSpades = () => {
          const fullSpades = `source ~/.bashrc 2>/dev/null || true && cd ${workingDir} && export PATH="${appConfig.condaPath}/bin:$PATH" && eval "$(${appConfig.condaPath}/bin/conda shell.bash hook)" && conda activate ${spadesEnv} && ${spadesCommand}`;
          conn.exec(fullSpades, (err, stream) => {
            if (err) { conn.end(); return res.status(500).json({ error: 'Failed to execute SPAdes', details: err.message }); }
            let out = '', errOut = '';
            stream.on('close', (code) => {
              executionResults.steps.push({ tool: 'SPAdes', command: fullSpades, exitCode: code, output: out, error: errOut, timestamp: new Date().toISOString() });
              if (code !== 0) { conn.end(); return res.json({ success: false, error: 'SPAdes failed', results: executionResults }); }
              const fullQuast = `source ~/.bashrc 2>/dev/null || true && cd ${workingDir} && export PATH="${appConfig.condaPath}/bin:$PATH" && eval "$(${appConfig.condaPath}/bin/conda shell.bash hook)" && conda activate ${quastEnv} && ${quastCommand}`;
              conn.exec(fullQuast, (err2, stream2) => {
                if (err2) { conn.end(); return res.status(500).json({ error: 'Failed to execute QUAST', details: err2.message }); }
                let qOut = '', qErr = '';
                stream2.on('close', (code2) => {
                  executionResults.steps.push({ tool: 'QUAST', command: fullQuast, exitCode: code2, output: qOut, error: qErr, timestamp: new Date().toISOString() });
                  executionResults.endTime = new Date().toISOString();
                  executionResults.totalSteps = 2;
                  executionResults.successfulSteps = executionResults.steps.filter(s => s.exitCode === 0).length;
                  conn.end();
                  res.json({ success: code2 === 0, message: code2 === 0 ? 'Real SPAdes + QUAST completed' : 'QUAST failed', results: executionResults });
                });
                stream2.on('data', (d) => { qOut += d.toString(); });
                stream2.stderr.on('data', (d) => { qErr += d.toString(); });
              });
            });
            stream.on('data', (d) => { out += d.toString(); });
            stream.stderr.on('data', (d) => { errOut += d.toString(); });
          });
        };
        runSpades();
      });
      conn.on('error', (err) => res.status(500).json({ error: 'SSH connection failed', details: err.message }));
      conn.connect(connectionDetails);
    } catch (error) {
      res.status(500).json({ error: 'Failed to run real workflow' });
    }
  });

  // Mock SPAdes + QUAST workflow
  app.post('/api/run-mock-spades-quast', checkConnectionAPI, async (req, res) => {
    try {
      const { workingDir, spadesEnv, quastEnv } = req.body;
      const connectionDetails = req.app.locals.connectionDetails;
      if (!connectionDetails) return res.status(400).json({ error: 'No connection details available' });
      const executionResults = { steps: [], startTime: new Date().toISOString(), workingDir, environments: { spadesEnv, quastEnv } };
      const conn = new Client();
      conn.on('ready', () => {
        const spadesCmd = `source ~/.bashrc 2>/dev/null || true && cd ${workingDir} && [ ! -f left.fastq.gz ] && printf "@read1\\nACGT\\n+\\nIIII\\n" | gzip > left.fastq.gz || true && [ ! -f right.fastq.gz ] && printf "@read2\\nTGCA\\n+\\nIIII\\n" | gzip > right.fastq.gz || true && export PATH="${appConfig.condaPath}/bin:$PATH" && eval "$(${appConfig.condaPath}/bin/conda shell.bash hook)" && conda activate spades_env && spades.py -1 left.fastq.gz -2 right.fastq.gz -o spades_output_folder`;
        conn.exec(spadesCmd, (err, stream) => {
          if (err) { conn.end(); return res.status(500).json({ error: 'SPAdes exec failed', details: err.message }); }
          let out = '', errOut = '';
          stream.on('close', (code) => {
            executionResults.steps.push({ tool: 'SPAdes', command: spadesCmd, exitCode: code, output: out, error: errOut, timestamp: new Date().toISOString() });
            if (code !== 0) { conn.end(); return res.json({ success: false, error: 'SPAdes failed', results: executionResults }); }
            const quastCmd = `source ~/.bashrc 2>/dev/null || true && cd ${workingDir} && export PATH="${appConfig.condaPath}/bin:$PATH" && eval "$(${appConfig.condaPath}/bin/conda shell.bash hook)" && conda activate quast_env && quast.py spades_output_folder/contigs.fasta -o quast_output_dir`;
            conn.exec(quastCmd, (err2, stream2) => {
              if (err2) { conn.end(); return res.status(500).json({ error: 'QUAST exec failed', details: err2.message }); }
              let qOut = '', qErr = '';
              stream2.on('close', (code2) => {
                executionResults.steps.push({ tool: 'QUAST', command: quastCmd, exitCode: code2, output: qOut, error: qErr, timestamp: new Date().toISOString() });
                executionResults.endTime = new Date().toISOString();
                executionResults.totalSteps = 2;
                executionResults.successfulSteps = executionResults.steps.filter(s => s.exitCode === 0).length;
                conn.end();
                res.json({ success: code2 === 0, message: code2 === 0 ? 'Mock SPAdes + QUAST completed' : 'QUAST failed', results: executionResults });
              });
              stream2.on('data', (d) => { qOut += d.toString(); });
              stream2.stderr.on('data', (d) => { qErr += d.toString(); });
            });
          });
          stream.on('data', (d) => { out += d.toString(); });
          stream.stderr.on('data', (d) => { errOut += d.toString(); });
        });
      });
      conn.on('error', (err) => res.status(500).json({ error: 'SSH failed', details: err.message }));
      conn.connect(connectionDetails);
    } catch (error) {
      res.status(500).json({ error: 'Failed to run mock workflow', details: error.message });
    }
  });

  // Save workflow to KG
  app.post('/api/kg/workflows/add', async (req, res) => {
    try {
      const { id, name, description = '', tags = [], category = 'metagenomics', nodes = [], connections = [] } = req.body;
      if (!id || !name || !Array.isArray(nodes) || !Array.isArray(connections)) return res.status(400).json({ error: 'id, name, nodes, and connections are required' });
      const nodeIds = new Set(nodes.map(n => n.id));
      const invalidConn = connections.find(c => !nodeIds.has(c.fromNode || c.from) || !nodeIds.has(c.toNode || c.to));
      if (invalidConn) return res.status(400).json({ error: 'Connections reference unknown nodes' });
      let enriched = null;
      try {
        const enrichResp = await axios.post('http://127.0.0.1:5111/kg/enrich', { id, name, description, tags, category, nodes, connections });
        if (enrichResp.data && enrichResp.data.success) enriched = enrichResp.data.workflow;
      } catch (err) { console.warn('Workflow enrich failed:', err.message); }
      const workflowToSave = enriched || { id, name, description, category, tags, nodes, connections };
      const kgWorkflow = {
        id: workflowToSave.id, name: workflowToSave.name, description: workflowToSave.description || '', category: workflowToSave.category || 'custom',
        complexity: workflowToSave.complexity || workflowToSave.resource_requirements?.complexity || 'moderate', keywords: workflowToSave.keywords || [], use_cases: workflowToSave.use_cases || [],
        natural_language_patterns: workflowToSave.natural_language_patterns || [], resource_requirements: workflowToSave.resource_requirements || {}, tags: workflowToSave.tags || [], steps: workflowToSave.steps || [], connections: workflowToSave.connections || []
      };
      if ((!kgWorkflow.steps || kgWorkflow.steps.length === 0) && nodes.length > 0) {
        kgWorkflow.steps = nodes.map((n, idx) => ({ order: idx + 1, tool: n.component || n.name || n.id || `step_${idx + 1}`, description: (n.config && n.config.description) || '' }));
      }
      if (!kgWorkflow.connections || kgWorkflow.connections.length === 0) {
        if (connections.length > 0) kgWorkflow.connections = connections.map((c, idx) => ({ from_tool: c.fromNode || c.from || '', to_tool: c.toNode || c.to || '', description: c.description || '', id: c.id || `connection_${idx + 1}` }));
        else if (kgWorkflow.steps.length > 1) {
          kgWorkflow.connections = [];
          for (let i = 0; i < kgWorkflow.steps.length - 1; i++) kgWorkflow.connections.push({ from_tool: kgWorkflow.steps[i].tool, to_tool: kgWorkflow.steps[i + 1].tool, description: '', id: `connection_${i + 1}` });
        }
      } else {
        kgWorkflow.connections = kgWorkflow.connections.map((c, idx) => ({ id: c.id || `connection_${idx + 1}`, from_tool: c.from_tool || c.fromNode || c.from || '', to_tool: c.to_tool || c.toNode || c.to || '', description: c.description || '', type: c.type || '' }));
      }
      const customPath = path.join(appConfig.paths.data, 'custom_workflows.json');
      let existing = { metadata: {}, tools: {}, workflows: {} };
      try {
        if (fsSync.existsSync(customPath)) {
          const raw = await fs.readFile(customPath, 'utf-8');
          const parsed = JSON.parse(raw || '{}');
          if (parsed && typeof parsed === 'object') existing = { metadata: parsed.metadata || {}, tools: parsed.tools || {}, workflows: parsed.workflows || {} };
        }
      } catch (err) { console.warn('Failed reading custom_workflows.json:', err.message); }
      existing.workflows[kgWorkflow.id] = kgWorkflow;
      await fs.writeFile(customPath, JSON.stringify(existing, null, 2), 'utf-8');
      try { await axios.post('http://127.0.0.1:5111/kg/reload', {}); } catch (reloadErr) { console.warn('KG reload failed:', reloadErr.message); }
      res.json({ success: true, saved: kgWorkflow });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save workflow', details: error.message });
    }
  });

  // Execute workflow (validate + run)
  app.post('/api/run-workflow', checkConnection, async (req, res) => {
    try {
      const workflow = req.body;
      if (!workflow.nodes || workflow.nodes.length === 0) return res.status(400).json({ error: 'No nodes in workflow' });
      const validation = workflowExecution.validateWorkflow(workflow);
      if (!validation.valid) return res.status(400).json({ error: 'Invalid workflow', details: validation.errors });
      const result = await workflowExecution.executeWorkflow(workflow, req.app.locals.connectionDetails);
      res.json({ success: true, result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to run workflow', details: error.message });
    }
  });
}

module.exports = { registerWorkflowRoutes };
