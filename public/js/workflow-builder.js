// Workflow Builder JavaScript
class WorkflowBuilder {
  constructor() {
    this.nodes = new Map();
    this.connections = new Map();
    this.selectedNode = null;
    this.draggingNode = null;
    this.connectingFrom = null;
    this.nodeCounter = 0;
    this.connectionCounter = 0;
    
    this.canvas = document.getElementById('workflow-canvas');
    this.propertiesPanel = document.getElementById('properties-panel');
    
    this.init();
  }

  init() {
    console.log('Initializing WorkflowBuilder...');
    
    // Check if required elements exist
    if (!this.canvas) {
      console.error('Canvas element not found!');
      return;
    }
    
    if (!this.propertiesPanel) {
      console.error('Properties panel not found!');
      return;
    }
    
    console.log('Canvas and properties panel found, loading components...');
    
    this.loadComponents();
    this.setupEventListeners();
    this.setupCanvas();
    
    console.log('WorkflowBuilder initialized successfully');
  }

  loadComponents() {
    // Load tools from tools.js
    this.loadTools();
    // Load visualization tools
    this.loadVisualizationTools();
  }

  async loadTools() {
    try {
      console.log('Loading tools...');
      const response = await fetch('/api/tools');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const tools = await response.json();
      console.log('Tools loaded:', tools);
      
      const toolContainer = document.getElementById('tool-components');
      if (!toolContainer) {
        console.error('Tool container not found!');
        return;
      }
      
      toolContainer.innerHTML = Object.values(tools).map(tool => `
        <div class="component-item" data-type="tool" data-component="${tool.toolName}" draggable="true">
          <i class="ti ti-tool mr-2"></i>
          ${tool.toolName}
        </div>
      `).join('');
      
      console.log('Tool components rendered');
    } catch (error) {
      console.error('Error loading tools:', error);
      // Show fallback content
      const toolContainer = document.getElementById('tool-components');
      if (toolContainer) {
        toolContainer.innerHTML = `
          <div class="text-center text-base-content/50 text-sm">
            Failed to load tools. Please refresh the page.
          </div>
        `;
      }
    }
  }

  async loadVisualizationTools() {
    try {
      console.log('Loading visualization tools...');
      const response = await fetch('/api/visualization-tools');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const vizTools = await response.json();
      console.log('Visualization tools loaded:', vizTools);
      
      const vizContainer = document.getElementById('viz-components');
      if (!vizContainer) {
        console.error('Visualization container not found!');
        return;
      }
      
      vizContainer.innerHTML = Object.values(vizTools).map(viz => `
        <div class="component-item" data-type="visualization" data-component="${viz.toolName}" draggable="true">
          <i class="ti ${viz.icon} mr-2"></i>
          ${viz.toolName}
        </div>
      `).join('');
      
      console.log('Visualization components rendered');
    } catch (error) {
      console.error('Error loading visualization tools:', error);
      // Show fallback content
      const vizContainer = document.getElementById('viz-components');
      if (vizContainer) {
        vizContainer.innerHTML = `
          <div class="text-center text-base-content/50 text-sm">
            Failed to load visualization tools. Please refresh the page.
          </div>
        `;
      }
    }
  }

  setupEventListeners() {
    // Component drag events
    document.addEventListener('dragstart', (e) => {
      const componentItem = e.target.closest('.component-item');
      if (componentItem) {
        this.startComponentDrag(e, componentItem);
      }
    });

    document.addEventListener('dragend', (e) => {
      const componentItem = e.target.closest('.component-item');
      if (componentItem) {
        componentItem.classList.remove('dragging');
      }
    });

    // Canvas events
    this.canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.canvas.classList.add('drag-over');
    });

    this.canvas.addEventListener('dragleave', (e) => {
      // Only remove class if we're leaving the canvas entirely
      if (!this.canvas.contains(e.relatedTarget)) {
        this.canvas.classList.remove('drag-over');
      }
    });

    this.canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      this.canvas.classList.remove('drag-over');
      this.handleComponentDrop(e);
    });

    // Node selection
    this.canvas.addEventListener('click', (e) => {
      const node = e.target.closest('.workflow-node');
      if (node) {
        this.selectNode(node);
      } else {
        this.deselectAll();
      }
    });

    // Delete key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' && this.selectedNode) {
        this.deleteNode(this.selectedNode);
      }
    });

    // Button events
    document.getElementById('clear-canvas').addEventListener('click', () => {
      this.clearCanvas();
    });

    document.getElementById('test-drag').addEventListener('click', () => {
      this.testDragFunctionality();
    });

    document.getElementById('run-workflow').addEventListener('click', () => {
      this.runWorkflow();
    });

    document.getElementById('save-workflow').addEventListener('click', () => {
      this.saveWorkflow();
    });

    document.getElementById('load-workflow').addEventListener('click', () => {
      this.loadWorkflow();
    });

    document.getElementById('export-workflow').addEventListener('click', () => {
      this.exportWorkflow();
    });

    // Component search
    document.getElementById('component-search').addEventListener('input', (e) => {
      this.filterComponents(e.target.value);
    });
  }

  setupCanvas() {
    // Add SVG overlay for connections
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'absolute inset-0 pointer-events-none');
    svg.style.zIndex = '1';
    this.canvas.appendChild(svg);
    this.svg = svg;
  }

  startComponentDrag(e, componentItem) {
    const componentType = componentItem.dataset.type;
    const componentName = componentItem.dataset.component;
    
    // Add visual feedback
    componentItem.classList.add('dragging');
    
    // Set drag data
    e.dataTransfer.setData('text/plain', JSON.stringify({
      type: componentType,
      component: componentName
    }));
    e.dataTransfer.effectAllowed = 'copy';
    
    // Set drag image (optional)
    const dragImage = componentItem.cloneNode(true);
    dragImage.style.opacity = '0.5';
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    
    // Remove the temporary element after a short delay
    setTimeout(() => {
      if (document.body.contains(dragImage)) {
        document.body.removeChild(dragImage);
      }
    }, 100);
  }

  handleComponentDrop(e) {
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      console.log('Dropping component:', data, 'at position:', { x, y });
      
      this.createNode(data.type, data.component, x, y);
    } catch (error) {
      console.error('Error handling component drop:', error);
      // Show user-friendly error message
      alert('Error dropping component. Please try again.');
    }
  }

  createNode(type, component, x, y) {
    const nodeId = `node_${++this.nodeCounter}`;
    const node = document.createElement('div');
    node.className = 'workflow-node';
    node.id = nodeId;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    
    let nodeContent = '';
    let inputs = [];
    let outputs = [];
    
    switch (type) {
      case 'file-input':
        nodeContent = this.createFileInputNode(component);
        outputs = ['file'];
        break;
      case 'file-output':
        nodeContent = this.createFileOutputNode(component);
        inputs = ['file'];
        break;
      case 'tool':
        nodeContent = this.createToolNode(component);
        inputs = ['file'];
        outputs = ['file'];
        break;
      case 'visualization':
        nodeContent = this.createVisualizationNode(component);
        inputs = ['file'];
        break;
    }
    
    node.innerHTML = nodeContent;
    
    // Add connection points
    this.addConnectionPoints(node, inputs, outputs);
    
    // Make node draggable
    this.makeNodeDraggable(node);
    
    // Store node data
    this.nodes.set(nodeId, {
      id: nodeId,
      type: type,
      component: component,
      x: x,
      y: y,
      inputs: inputs,
      outputs: outputs,
      config: {}
    });
    
    this.canvas.appendChild(node);
    this.selectNode(node);
  }

  createFileInputNode(component) {
    return `
      <div class="node-header">
        <div class="node-title">${component === 'local-file' ? 'Local File' : 'Server File'}</div>
        <div class="node-type">Input</div>
      </div>
      <div class="node-content">
        <button class="btn btn-xs btn-outline" onclick="workflowBuilder.configureNode('${component}')">
          <i class="ti ti-settings mr-1"></i>
          Configure
        </button>
      </div>
    `;
  }

  createFileOutputNode(component) {
    return `
      <div class="node-header">
        <div class="node-title">${component === 'local-folder' ? 'Local Folder' : 'Server Folder'}</div>
        <div class="node-type">Output</div>
      </div>
      <div class="node-content">
        <button class="btn btn-xs btn-outline" onclick="workflowBuilder.configureNode('${component}')">
          <i class="ti ti-settings mr-1"></i>
          Configure
        </button>
      </div>
    `;
  }

  createToolNode(component) {
    return `
      <div class="node-header">
        <div class="node-title">${component}</div>
        <div class="node-type">Tool</div>
      </div>
      <div class="node-content">
        <button class="btn btn-xs btn-outline" onclick="workflowBuilder.configureNode('${component}')">
          <i class="ti ti-settings mr-1"></i>
          Configure
        </button>
      </div>
    `;
  }

  createVisualizationNode(component) {
    return `
      <div class="node-header">
        <div class="node-title">${component}</div>
        <div class="node-type">Visualization</div>
      </div>
      <div class="node-content">
        <button class="btn btn-xs btn-outline" onclick="workflowBuilder.configureNode('${component}')">
          <i class="ti ti-settings mr-1"></i>
          Configure
        </button>
      </div>
    `;
  }

  addConnectionPoints(node, inputs, outputs) {
    const nodeData = this.nodes.get(node.id);
    
    // Add input ports
    inputs.forEach((input, index) => {
      const port = document.createElement('div');
      port.className = 'node-connection-point input';
      port.dataset.port = input;
      port.dataset.type = 'input';
      port.style.left = '0px';
      port.style.top = `${20 + index * 20}px`;
      
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.startConnection(node.id, input, 'input');
      });
      
      node.appendChild(port);
    });
    
    // Add output ports
    outputs.forEach((output, index) => {
      const port = document.createElement('div');
      port.className = 'node-connection-point output';
      port.dataset.port = output;
      port.dataset.type = 'output';
      port.style.right = '0px';
      port.style.top = `${20 + index * 20}px`;
      
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.startConnection(node.id, output, 'output');
      });
      
      node.appendChild(port);
    });
  }

  makeNodeDraggable(node) {
    let isDragging = false;
    let startX, startY, startLeft, startTop;
    
    node.addEventListener('mousedown', (e) => {
      if (e.target.closest('.node-connection-point')) return;
      
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseInt(node.style.left);
      startTop = parseInt(node.style.top);
      
      node.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      node.style.left = `${startLeft + deltaX}px`;
      node.style.top = `${startTop + deltaY}px`;
      
      // Update node data
      const nodeData = this.nodes.get(node.id);
      if (nodeData) {
        nodeData.x = startLeft + deltaX;
        nodeData.y = startTop + deltaY;
      }
      
      // Update connections
      this.updateConnections(node.id);
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        node.style.cursor = 'grab';
      }
    });
  }

  startConnection(nodeId, port, type) {
    this.connectingFrom = { nodeId, port, type };
    
    // Add temporary connection line
    this.tempConnection = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    this.tempConnection.setAttribute('class', 'workflow-connection');
    this.svg.appendChild(this.tempConnection);
    
    document.addEventListener('mousemove', this.updateTempConnection.bind(this));
    document.addEventListener('mouseup', this.endConnection.bind(this));
  }

  updateTempConnection(e) {
    if (!this.connectingFrom || !this.tempConnection) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const fromNode = document.getElementById(this.connectingFrom.nodeId);
    const fromPort = fromNode.querySelector(`[data-port="${this.connectingFrom.port}"]`);
    const fromRect = fromPort.getBoundingClientRect();
    const fromX = fromRect.left + fromRect.width / 2 - rect.left;
    const fromY = fromRect.top + fromRect.height / 2 - rect.top;
    
    this.tempConnection.setAttribute('x1', fromX);
    this.tempConnection.setAttribute('y1', fromY);
    this.tempConnection.setAttribute('x2', x);
    this.tempConnection.setAttribute('y2', y);
  }

  endConnection(e) {
    if (!this.connectingFrom) return;
    
    const target = e.target.closest('.node-connection-point');
    if (target && target.dataset.type !== this.connectingFrom.type) {
      const targetNode = target.closest('.workflow-node');
      const targetNodeId = targetNode.id;
      const targetPort = target.dataset.port;
      
      this.createConnection(
        this.connectingFrom.nodeId,
        this.connectingFrom.port,
        targetNodeId,
        targetPort
      );
    }
    
    // Clean up
    if (this.tempConnection) {
      this.tempConnection.remove();
      this.tempConnection = null;
    }
    
    this.connectingFrom = null;
    document.removeEventListener('mousemove', this.updateTempConnection);
    document.removeEventListener('mouseup', this.endConnection);
  }

  createConnection(fromNodeId, fromPort, toNodeId, toPort) {
    const connectionId = `connection_${++this.connectionCounter}`;
    
    const connection = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    connection.setAttribute('class', 'workflow-connection');
    connection.id = connectionId;
    
    this.svg.appendChild(connection);
    this.updateConnectionPath(connectionId, fromNodeId, fromPort, toNodeId, toPort);
    
    this.connections.set(connectionId, {
      id: connectionId,
      fromNode: fromNodeId,
      fromPort: fromPort,
      toNode: toNodeId,
      toPort: toPort
    });
  }

  updateConnectionPath(connectionId, fromNodeId, fromPort, toNodeId, toPort) {
    const connection = document.getElementById(connectionId);
    const fromNode = document.getElementById(fromNodeId);
    const toNode = document.getElementById(toNodeId);
    
    if (!fromNode || !toNode) return;
    
    const fromPortElement = fromNode.querySelector(`[data-port="${fromPort}"]`);
    const toPortElement = toNode.querySelector(`[data-port="${toPort}"]`);
    
    if (!fromPortElement || !toPortElement) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const fromRect = fromPortElement.getBoundingClientRect();
    const toRect = toPortElement.getBoundingClientRect();
    
    const fromX = fromRect.left + fromRect.width / 2 - rect.left;
    const fromY = fromRect.top + fromRect.height / 2 - rect.top;
    const toX = toRect.left + toRect.width / 2 - rect.left;
    const toY = toRect.top + toRect.height / 2 - rect.top;
    
    const controlX = (fromX + toX) / 2;
    
    const path = `M ${fromX} ${fromY} Q ${controlX} ${fromY} ${toX} ${toY}`;
    connection.setAttribute('d', path);
  }

  updateConnections(nodeId) {
    this.connections.forEach((connection, connectionId) => {
      if (connection.fromNode === nodeId || connection.toNode === nodeId) {
        this.updateConnectionPath(
          connectionId,
          connection.fromNode,
          connection.fromPort,
          connection.toNode,
          connection.toPort
        );
      }
    });
  }

  selectNode(node) {
    this.deselectAll();
    node.classList.add('selected');
    this.selectedNode = node;
    this.showNodeProperties(node);
  }

  deselectAll() {
    document.querySelectorAll('.workflow-node').forEach(node => {
      node.classList.remove('selected');
    });
    this.selectedNode = null;
    this.hideProperties();
  }

  showNodeProperties(node) {
    const nodeData = this.nodes.get(node.id);
    if (!nodeData) return;
    
    this.propertiesPanel.innerHTML = `
      <div class="space-y-4">
        <div>
          <label class="label">
            <span class="label-text">Node ID</span>
          </label>
          <input type="text" class="input input-bordered w-full" value="${nodeData.id}" readonly>
        </div>
        <div>
          <label class="label">
            <span class="label-text">Type</span>
          </label>
          <input type="text" class="input input-bordered w-full" value="${nodeData.type}" readonly>
        </div>
        <div>
          <label class="label">
            <span class="label-text">Component</span>
          </label>
          <input type="text" class="input input-bordered w-full" value="${nodeData.component}" readonly>
        </div>
        <div>
          <label class="label">
            <span class="label-text">Position</span>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <input type="number" class="input input-bordered" value="${nodeData.x}" 
                   onchange="workflowBuilder.updateNodePosition('${nodeData.id}', 'x', this.value)">
            <input type="number" class="input input-bordered" value="${nodeData.y}" 
                   onchange="workflowBuilder.updateNodePosition('${nodeData.id}', 'y', this.value)">
          </div>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-primary btn-sm" onclick="workflowBuilder.configureNode('${nodeData.component}')">
            <i class="ti ti-settings mr-1"></i>
            Configure
          </button>
          <button class="btn btn-error btn-sm" onclick="workflowBuilder.deleteNode('${nodeData.id}')">
            <i class="ti ti-trash mr-1"></i>
            Delete
          </button>
        </div>
      </div>
    `;
  }

  hideProperties() {
    this.propertiesPanel.innerHTML = `
      <div class="text-center text-base-content/50">
        Select a component to view its properties
      </div>
    `;
  }

  updateNodePosition(nodeId, axis, value) {
    const node = document.getElementById(nodeId);
    const nodeData = this.nodes.get(nodeId);
    
    if (node && nodeData) {
      node.style[axis] = `${value}px`;
      nodeData[axis] = parseInt(value);
      this.updateConnections(nodeId);
    }
  }

  deleteNode(nodeId) {
    const node = document.getElementById(nodeId);
    if (node) {
      node.remove();
    }
    
    // Remove connections
    const connectionsToRemove = [];
    this.connections.forEach((connection, connectionId) => {
      if (connection.fromNode === nodeId || connection.toNode === nodeId) {
        connectionsToRemove.push(connectionId);
      }
    });
    
    connectionsToRemove.forEach(connectionId => {
      const connection = document.getElementById(connectionId);
      if (connection) {
        connection.remove();
      }
      this.connections.delete(connectionId);
    });
    
    this.nodes.delete(nodeId);
    this.deselectAll();
  }

  clearCanvas() {
    if (confirm('Are you sure you want to clear the entire workflow?')) {
      this.nodes.clear();
      this.connections.clear();
      this.canvas.innerHTML = `
        <div class="absolute inset-0 flex items-center justify-center text-base-content/50">
          <div class="text-center">
            <i class="ti ti-mouse text-4xl mb-2"></i>
            <p>Drag components from the left panel to start building your workflow</p>
          </div>
        </div>
      `;
      this.setupCanvas();
      this.deselectAll();
    }
  }

  filterComponents(query) {
    const componentItems = document.querySelectorAll('.component-item');
    componentItems.forEach(item => {
      const text = item.textContent.toLowerCase();
      if (text.includes(query.toLowerCase())) {
        item.style.display = 'block';
      } else {
        item.style.display = 'none';
      }
    });
  }

  configureNode(component) {
    // This will be implemented to show configuration modal
    console.log('Configure node:', component);
    // For now, just show a simple alert
    alert(`Configure ${component} - This feature will be implemented soon!`);
  }

  async runWorkflow() {
    const workflow = this.exportWorkflow();
    if (workflow.nodes.length === 0) {
      alert('No nodes in workflow to run');
      return;
    }
    
    try {
      const response = await fetch('/api/run-workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(workflow)
      });
      
      const result = await response.json();
      if (result.success) {
        alert('Workflow started successfully!');
      } else {
        alert('Error running workflow: ' + result.error);
      }
    } catch (error) {
      console.error('Error running workflow:', error);
      alert('Error running workflow');
    }
  }

  saveWorkflow() {
    const workflow = this.exportWorkflow();
    const dataStr = JSON.stringify(workflow, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = 'workflow.json';
    link.click();
  }

  loadWorkflow() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const workflow = JSON.parse(e.target.result);
            this.importWorkflow(workflow);
          } catch (error) {
            alert('Error loading workflow file');
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }

  exportWorkflow() {
    return {
      nodes: Array.from(this.nodes.values()),
      connections: Array.from(this.connections.values())
    };
  }

  importWorkflow(workflow) {
    this.clearCanvas();
    
    // Import nodes
    workflow.nodes.forEach(nodeData => {
      this.createNode(nodeData.type, nodeData.component, nodeData.x, nodeData.y);
    });
    
    // Import connections
    workflow.connections.forEach(connectionData => {
      this.createConnection(
        connectionData.fromNode,
        connectionData.fromPort,
        connectionData.toNode,
        connectionData.toPort
      );
    });
  }

  testDragFunctionality() {
    console.log('Testing drag functionality...');
    
    // Test if components are draggable
    const components = document.querySelectorAll('.component-item');
    console.log('Found components:', components.length);
    
    components.forEach((component, index) => {
      const isDraggable = component.draggable;
      const hasData = component.dataset.type && component.dataset.component;
      console.log(`Component ${index + 1}:`, {
        text: component.textContent.trim(),
        draggable: isDraggable,
        hasData: hasData,
        type: component.dataset.type,
        component: component.dataset.component
      });
    });
    
    // Test canvas drop zone
    console.log('Canvas drop zone:', {
      element: this.canvas,
      exists: !!this.canvas,
      id: this.canvas?.id,
      className: this.canvas?.className
    });
    
    // Create a test node to verify node creation works
    this.createNode('file-input', 'local-file', 100, 100);
    console.log('Test node created successfully');
    
    alert('Drag test completed. Check console for details.');
  }
}

// Global functions for modal interactions
function closeComponentConfig() {
  document.getElementById('component-config-modal').close();
}

function saveComponentConfig() {
  // Implementation for saving component configuration
  document.getElementById('component-config-modal').close();
}

function closeFileBrowser() {
  document.getElementById('file-browser-modal').close();
}

function selectFile() {
  // Implementation for file selection
  document.getElementById('file-browser-modal').close();
}

// Initialize workflow builder when page loads
let workflowBuilder;
document.addEventListener('DOMContentLoaded', () => {
  workflowBuilder = new WorkflowBuilder();
}); 