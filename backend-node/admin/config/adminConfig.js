const path = require('path');

// When running from backend-node/, project root is two levels up from admin/config
const projectRoot = path.resolve(__dirname, '..', '..', '..');

module.exports = {
  paths: {
    helpDir: path.join(projectRoot, 'data', 'help'),
    parametersDir: path.join(projectRoot, 'data', 'parameters'),
    tempUploadsDir: path.join(projectRoot, 'backend-node', 'temp_uploads'),
    tempDir: path.join(projectRoot, 'backend-node', 'temp'),
    scriptsDir: path.join(__dirname, '..', 'scripts'),
  },

  scripts: {
    param: path.join(__dirname, '..', 'scripts/param.py'),
    jsonToHelp: path.join(__dirname, '..', 'scripts/json_to_help.py'),
    compareHelp: path.join(__dirname, '..', 'scripts/compare_help_html.py'),
  },

  upload: {
    maxFileSize: 5 * 1024 * 1024,
    allowedFileTypes: ['.txt'],
  },

  tool: {
    defaultEnv: '',
    defaultHtml: 'tool.ejs',
    defaultHasStderr: true,
  },

  admin: {
    roleName: 'admin',
    sessionTimeout: 24 * 60 * 60 * 1000,
  },

  errors: {
    fileUpload: {
      noFile: 'No file uploaded',
      invalidType: 'Invalid file type. Only .txt files are allowed',
      tooLarge: 'File size exceeds the maximum limit of 5MB',
    },
    tool: {
      notFound: 'Tool not found',
      alreadyExists: 'Tool already exists',
      invalidName: 'Invalid tool name',
    },
    process: {
      paramExtraction: 'Failed to extract parameters from help file',
      jsonConversion: 'Failed to convert help file to JSON',
      comparison: 'Failed to generate comparison report',
    },
  },

  messages: {
    tool: {
      added: 'Tool added successfully',
      deleted: 'Tool deleted successfully',
      updated: 'Tool updated successfully',
    },
  },
};
