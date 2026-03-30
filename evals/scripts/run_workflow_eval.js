/**
 * Workflow evaluation: call /api/run-generic-workflow (or equivalent),
 * run on evals/datasets/workflow_s1.json config, compute Success Rate + biology metrics.
 * Usage: node evals/scripts/run_workflow_eval.js [--config evals/datasets/workflow_s1.json]
 * See docs/evaluation-guide.md for which paper results use this script.
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..', '..');
const defaultConfig = path.join(projectRoot, 'evals', 'datasets', 'workflow_s1.json');

const configPath = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : defaultConfig;

if (!fs.existsSync(configPath)) {
  console.error('Config not found:', configPath);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
console.log('Workflow eval stub. Config:', config.name || configPath);
console.log('Implement: POST /api/run-generic-workflow with config, then compute Success Rate + biology metrics.');
