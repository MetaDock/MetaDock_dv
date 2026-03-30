/**
 * Basic Node-side unit tests (no extra framework).
 *
 * Run with:
 *   node tests/node/test_node_config.js
 *
 * These tests verify that the Node config module loads correctly
 * and exposes expected fields used by the backend.
 */

const assert = require('assert');
const path = require('path');

// Resolve project root from this test file
const root = path.resolve(__dirname, '..', '..');
const configPath = path.join(root, 'backend-node', 'config', 'index.js');

console.log('Loading Node config from:', configPath);
// eslint-disable-next-line import/no-dynamic-require, global-require
const appConfig = require(configPath);

// Port and environment
assert.ok(
  typeof appConfig.port === 'number' && appConfig.port > 0,
  `Expected numeric port, got: ${appConfig.port}`,
);
assert.ok(
  typeof appConfig.nodeEnv === 'string' && appConfig.nodeEnv.length > 0,
  'Expected nodeEnv to be a non-empty string',
);

// Session secret
assert.ok(
  typeof appConfig.sessionSecret === 'string' && appConfig.sessionSecret.length > 0,
  'Expected sessionSecret to be a non-empty string',
);

// Project root
assert.ok(
  typeof appConfig.projectRoot === 'string' && appConfig.projectRoot.length > 0,
  `Expected projectRoot to be a non-empty string, got: ${appConfig.projectRoot}`,
);

// Paths object (shape defined in backend-node/config/index.js)
assert.ok(appConfig.paths && typeof appConfig.paths === 'object', 'Expected paths object');
['frontendPublic', 'frontendViews', 'adminViews', 'data', 'parameters', 'helpPages', 'tempUploads'].forEach(
  (key) => {
    assert.ok(
      typeof appConfig.paths[key] === 'string' && appConfig.paths[key].length > 0,
      `Expected paths.${key} to be a non-empty string`,
    );
  },
);

console.log('All Node config tests passed.');

