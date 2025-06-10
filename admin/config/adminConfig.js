const path = require('path');

module.exports = {
  // File paths
  paths: {
    // Directory for storing help files
    helpDir: path.join(__dirname, '../../help'),
    // Directory for storing parameter files
    parametersDir: path.join(__dirname, '../../parameters'),
    // Directory for temporary file uploads
    tempUploadsDir: path.join(__dirname, '../../temp_uploads'),
    // Directory for Python scripts
    scriptsDir: path.join(__dirname, '../scripts'),
  },

  // Python script paths
  scripts: {
    param: path.join(__dirname, '../scripts/param.py'),
    jsonToHelp: path.join(__dirname, '../scripts/json_to_help.py'),
    compareHelp: path.join(__dirname, '../scripts/compare_help_html.py'),
  },

  // File upload settings
  upload: {
    // Maximum file size (in bytes)
    maxFileSize: 5 * 1024 * 1024, // 5MB
    // Allowed file types
    allowedFileTypes: ['.txt'],
  },

  // Tool configuration
  tool: {
    // Default environment setup for new tools
    defaultEnv: '',
    // Default HTML template
    defaultHtml: 'tool.ejs',
    // Default error handling
    defaultHasStderr: true,
  },

  // Admin settings
  admin: {
    // Admin role name
    roleName: 'admin',
    // Session timeout (in milliseconds)
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
  },

  // Error messages
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

  // Success messages
  messages: {
    tool: {
      added: 'Tool added successfully',
      deleted: 'Tool deleted successfully',
      updated: 'Tool updated successfully',
    },
  },
}; 