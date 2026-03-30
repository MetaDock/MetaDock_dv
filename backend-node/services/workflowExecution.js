/**
 * Workflow validation and execution helpers.
 * Used by POST /api/run-workflow and workflow builder.
 */
const path = require('path');
const sshHelpers = require('../lib/sshHelpers');

function validateWorkflow(workflow) {
  const errors = [];
  if (checkForCycles(workflow)) errors.push('Workflow contains cycles');
  const disconnectedNodes = findDisconnectedNodes(workflow);
  if (disconnectedNodes.length > 0) errors.push(`Disconnected nodes: ${disconnectedNodes.join(', ')}`);
  const missingInputs = findMissingInputs(workflow);
  if (missingInputs.length > 0) errors.push(`Missing inputs: ${missingInputs.join(', ')}`);
  return { valid: errors.length === 0, errors };
}

function checkForCycles(workflow) {
  const visited = new Set();
  const recStack = new Set();
  function hasCycle(nodeId) {
    if (recStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    recStack.add(nodeId);
    for (const conn of workflow.connections.filter(c => c.fromNode === nodeId)) {
      if (hasCycle(conn.toNode)) return true;
    }
    recStack.delete(nodeId);
    return false;
  }
  for (const node of workflow.nodes) {
    if (!visited.has(node.id) && hasCycle(node.id)) return true;
  }
  return false;
}

function findDisconnectedNodes(workflow) {
  const connectedNodes = new Set();
  workflow.connections.forEach(conn => {
    connectedNodes.add(conn.fromNode);
    connectedNodes.add(conn.toNode);
  });
  return workflow.nodes.filter(n => !connectedNodes.has(n.id)).map(n => n.id);
}

function findMissingInputs(workflow) {
  const missing = [];
  for (const node of workflow.nodes) {
    if ((node.type === 'tool' || node.type === 'visualization') &&
        !workflow.connections.some(c => c.toNode === node.id)) {
      missing.push(node.id);
    }
  }
  return missing;
}

function getExecutionOrder(workflow) {
  const inDegree = new Map();
  const graph = new Map();
  workflow.nodes.forEach(n => { inDegree.set(n.id, 0); graph.set(n.id, []); });
  workflow.connections.forEach(conn => {
    graph.get(conn.fromNode).push(conn.toNode);
    inDegree.set(conn.toNode, inDegree.get(conn.toNode) + 1);
  });
  const queue = [];
  const order = [];
  for (const [nodeId, degree] of inDegree) if (degree === 0) queue.push(nodeId);
  while (queue.length > 0) {
    const nodeId = queue.shift();
    order.push(nodeId);
    for (const neighbor of graph.get(nodeId)) {
      inDegree.set(neighbor, inDegree.get(neighbor) - 1);
      if (inDegree.get(neighbor) === 0) queue.push(neighbor);
    }
  }
  return order;
}

function getNodeOutputFiles(node, workflow) {
  switch (node.type) {
    case 'file-input':
      return node.config?.files || [];
    case 'tool':
      if (node.component === 'spades') {
        const out = node.config?.['o'] || node.config?.['output-dir'] || 'spades_output';
        return [`${out}/contigs.fasta`, `${out}/scaffolds.fasta`];
      }
      if (node.component === 'quast') {
        const out = node.config?.['o'] || node.config?.['output-dir'] || 'quast_output';
        return [`${out}/report.html`, `${out}/report.txt`];
      }
      return [`${node.component}_output.txt`];
    case 'visualization':
      return [`${node.component}_viz.html`];
    default:
      return [];
  }
}

function getInputFiles(nodeId, workflow, executedNodes) {
  const inputFiles = [];
  for (const conn of workflow.connections.filter(c => c.toNode === nodeId)) {
    const source = workflow.nodes.find(n => n.id === conn.fromNode);
    if (source && executedNodes.has(source.id)) {
      inputFiles.push(...getNodeOutputFiles(source, workflow));
    }
  }
  return inputFiles;
}

function buildToolCommand(node, inputFiles) {
  let command = '';
  const condaEnv = node.config?.['conda-env'] || node.config?.['conda_env'];
  if (condaEnv) command = `conda activate ${condaEnv} && `;
  if (node.component === 'spades') command += 'spades.py';
  else if (node.component === 'quast') command += 'quast.py';
  else command += node.component;
  if (node.config) {
    Object.entries(node.config).forEach(([key, value]) => {
      if (key === 'conda-env' || key === 'conda_env') return;
      if (value !== null && value !== undefined && value !== '' && value !== false) {
        if (value === true) command += ` --${key}`;
        else command += (key.length === 1 ? ` -${key} ${value}` : ` --${key} ${value}`);
      }
    });
  }
  if (node.component === 'quast' && inputFiles.length > 0) command += ` ${inputFiles.join(' ')}`;
  else if (inputFiles.length > 0 && !node.config?.['-1'] && !node.config?.['1']) command += ` ${inputFiles.join(' ')}`;
  return command;
}

async function executeFileInput(node, workflow) {
  return { message: 'File input ready' };
}

async function executeTool(node, workflow, connectionDetails, executedNodes) {
  const inputFiles = getInputFiles(node.id, workflow, executedNodes);
  const command = buildToolCommand(node, inputFiles);
  return await sshHelpers.executeRemoteCommand(command, connectionDetails);
}

async function executeVisualization(node, workflow, executedNodes) {
  const inputFiles = getInputFiles(node.id, workflow, executedNodes);
  return { message: 'Visualization generated', inputFiles };
}

async function executeFileOutput(node, workflow, executedNodes) {
  const inputFiles = getInputFiles(node.id, workflow, executedNodes);
  return { message: 'Files copied to output', inputFiles };
}

async function executeNode(node, workflow, connectionDetails, executedNodes) {
  switch (node.type) {
    case 'file-input': return await executeFileInput(node, workflow);
    case 'tool': return await executeTool(node, workflow, connectionDetails, executedNodes);
    case 'visualization': return await executeVisualization(node, workflow, executedNodes);
    case 'file-output': return await executeFileOutput(node, workflow, executedNodes);
    default: throw new Error(`Unknown node type: ${node.type}`);
  }
}

async function executeWorkflow(workflow, connectionDetails) {
  const results = [];
  const executedNodes = new Set();
  const executionOrder = getExecutionOrder(workflow);
  for (const nodeId of executionOrder) {
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) continue;
    try {
      const result = await executeNode(node, workflow, connectionDetails, executedNodes);
      results.push({ nodeId, nodeType: node.type, success: true, result });
      executedNodes.add(nodeId);
    } catch (error) {
      results.push({ nodeId, nodeType: node.type, success: false, error: error.message });
      const nodeConfig = workflow.nodes.find(n => n.id === nodeId)?.config;
      if (!nodeConfig?.continueOnError) break;
    }
  }
  return results;
}

module.exports = {
  validateWorkflow,
  checkForCycles,
  findDisconnectedNodes,
  findMissingInputs,
  getExecutionOrder,
  getInputFiles,
  getNodeOutputFiles,
  buildToolCommand,
  executeWorkflow,
  executeNode
};
