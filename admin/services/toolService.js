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

// 获取所有工具
exports.findAll = () => {
    return getTools();
};

// 获取被推荐的工具
exports.findRecommended = () => {
    const allTools = getTools();
    return allTools.filter(tool => tool.isRecommended);
};

// 根据ID查找工具
exports.findByIds = (ids) => {
    const allTools = getTools();
    return allTools.filter(tool => ids.includes(tool.id));
};