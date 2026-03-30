// services/toolService.js
const fs = require('fs');
const path = require('path');

const toolsFilePath = path.join(__dirname, '..', 'data', 'tools_install.json');

const getTools = () => {
    try {
        const jsonData = fs.readFileSync(toolsFilePath);
        return JSON.parse(jsonData);
    } catch (error) {
        console.error('Error reading tools file:', error);
        return [];
    }
};

// get all tools
exports.findAll = () => {
    return getTools();
};

// get recommended tools
exports.findRecommended = () => {
    const allTools = getTools();
    return allTools.filter(tool => tool.isRecommended);
};

// find tools by IDs
exports.findByIds = (ids) => {
    const allTools = getTools();
    return allTools.filter(tool => ids.includes(tool.id));
};