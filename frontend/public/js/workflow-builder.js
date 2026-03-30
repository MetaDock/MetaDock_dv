// Workflow Builder JavaScript
class WorkflowBuilder {
  constructor() {
    console.log('WorkflowBuilder constructor called');
    
    // Prevent multiple instances
    if (window.workflowBuilder) {
      console.warn('WorkflowBuilder instance already exists! This may cause duplicate behavior.');
    }
    
    // Setup cleanup on page unload
    this.setupCleanup();
    
    this.nodes = new Map();
    this.connections = new Map();
    this.selectedNode = null;
    this.draggingNode = null;
    this.connectingFrom = null;
    this.nodeCounter = 0;
    this.connectionCounter = 0;
    this.eventListenersSetup = false;
    this.lastJobId = null; // Store the most recent workflow job ID
    this.isRunning = false; // Track workflow execution state
    
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
    this.updateDeleteButtonState();
    
    console.log('WorkflowBuilder initialized successfully');
    
    // Add debug helper
    window.debugWorkflow = () => this.debugWorkflowState();
  }
  
  debugWorkflowState() {
    console.log('=== Workflow Debug Info ===');
    console.log('Canvas:', this.canvas);
    console.log('Nodes:', this.nodes);
    console.log('Connections:', this.connections);
    console.log('Canvas children:', this.canvas.children.length);
    
    // Check if components are loaded
    const toolContainer = document.getElementById('tool-components');
    console.log('Tool container children:', toolContainer?.children.length || 'Not found');
    
    // List all nodes
    this.nodes.forEach((node, id) => {
      const domNode = document.getElementById(id);
      console.log(`Node ${id}:`, {
        data: node,
        domElement: domNode,
        connectionPoints: domNode?.querySelectorAll('.node-connection-point').length || 0
      });
    });
  }

  setupCleanup() {
    // Clean up polling intervals when page is unloaded
    window.addEventListener('beforeunload', () => {
      if (window.workflowPollingInterval) {
        clearInterval(window.workflowPollingInterval);
        window.workflowPollingInterval = null;
      }
    });
    
    // Also clean up on visibility change (tab switching)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        // Page is hidden, but keep polling
        console.log('Page hidden, continuing background polling');
      } else {
        // Page is visible again
        console.log('Page visible again');
      }
    });
  }

  updateCanvasPlaceholder() {
    const placeholder = document.getElementById('canvas-placeholder');
    if (placeholder) {
      if (this.nodes.size > 0) {
        // Hide placeholder when there are nodes
        placeholder.style.display = 'none';
      } else {
        // Show placeholder when canvas is empty
        placeholder.style.display = 'flex';
      }
    }
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
    console.log('Setting up event listeners...');
    
    // Prevent duplicate event listeners
    if (this.eventListenersSetup) {
      console.log('Event listeners already setup, skipping...');
      return;
    }
    this.eventListenersSetup = true;
    
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
        this.deleteSelectedNode();
      }
    });

    // Button events
    document.getElementById('clear-canvas').addEventListener('click', () => {
      this.clearCanvas();
    });

    // Optional test-drag button (only exists in debug page)
    const testDragBtn = document.getElementById('test-drag');
    if (testDragBtn) {
      testDragBtn.addEventListener('click', () => {
      this.testDragFunctionality();
    });
    }

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

    const deleteSelectedBtn = document.getElementById('delete-selected');
    if (deleteSelectedBtn) {
      deleteSelectedBtn.addEventListener('click', () => {
        this.deleteSelectedNode();
      });
    }

    // Component search (optional)
    const componentSearch = document.getElementById('component-search');
    if (componentSearch) {
      componentSearch.addEventListener('input', (e) => {
      this.filterComponents(e.target.value);
    });
    }
  }

  setupCanvas() {
    // Add SVG overlay for connections
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'absolute inset-0');
    svg.style.zIndex = '1';
    svg.style.pointerEvents = 'none'; // Make SVG transparent to mouse events by default
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    
    // No viewBox - use 1:1 coordinate mapping with canvas
    // This ensures SVG coordinates match DOM coordinates exactly
    
    this.canvas.appendChild(svg);
    this.svg = svg;
    
    console.log('SVG setup complete:', {
      width: svg.style.width,
      height: svg.style.height,
      viewBox: svg.getAttribute('viewBox')
    });
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
      let x = e.clientX - rect.left;
      let y = e.clientY - rect.top;
      
      // Apply boundary constraints for new nodes
      const nodeWidth = 200; // Fixed width as per CSS
      const nodeHeight = 100; // Estimated height
      const minX = 10;
      const minY = 10;
      const maxX = this.canvas.offsetWidth - nodeWidth - 10;
      const maxY = this.canvas.offsetHeight - nodeHeight - 10;
      
      // Constrain drop position within boundaries
      x = Math.max(minX, Math.min(maxX, x));
      y = Math.max(minY, Math.min(maxY, y));
      
      console.log('Dropping component:', data, 'at constrained position:', { x, y });
      console.log('Current nodes before creation:', this.nodes.size);
      
      this.createNode(data.type, data.component, x, y);
      
      console.log('Current nodes after creation:', this.nodes.size);
    } catch (error) {
      console.error('Error handling component drop:', error);
      // Show user-friendly error message
      alert('Error dropping component. Please try again.');
    }
  }

  createNode(type, component, x, y) {
    console.log('Creating node:', { type, component, x, y });
    
    const nodeId = `node_${++this.nodeCounter}`;
    const node = document.createElement('div');
    let nodeClasses = 'workflow-node';
    if (type === 'tool') {
      nodeClasses += ' tool-node';
    } else if (type === 'file-input') {
      nodeClasses += ' file-input-node';
    } else if (type === 'file-output') {
      nodeClasses += ' file-output-node';
    }
    node.className = nodeClasses;
    node.id = nodeId;
    node.setAttribute('data-component', component);  // Add data-component attribute
    node.setAttribute('data-type', type);  // Add data-type attribute for debugging
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.position = 'absolute';
    node.style.zIndex = '10';
    
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
        
        // Configure inputs/outputs based on tool type
        if (component === 'spades') {
          inputs = ['reads_1', 'reads_2'];  // -1 and -2 parameters
          outputs = ['contigs'];  // contigs.fasta output
        } else if (component === 'quast') {
          inputs = ['contigs'];  // contigs.fasta input
          outputs = ['report'];  // quality report output
        } else {
          inputs = ['input'];
          outputs = ['output'];
        }
        break;
      case 'visualization':
        nodeContent = this.createVisualizationNode(component);
        inputs = ['file'];
        break;
    }
    
    node.innerHTML = nodeContent;
    
    // Add connection points after a small delay to ensure DOM is ready
    setTimeout(() => {
    this.addConnectionPoints(node, inputs, outputs);
    }, 50);
    
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
    
    // Hide placeholder when first node is added
    this.updateCanvasPlaceholder();
    
    // Log for debugging
    console.log(`Created node: ${nodeId}, type: ${type}, component: ${component}`);
    
    // Return node information for external use
    return {
      id: nodeId,
      element: node,
      type: type,
      component: component
    };
  }

  createFileInputNode(component) {
    const displayName = component === 'local-file' ? 'Local File' : 'Server File';
    const icon = component === 'local-file' ? 'ti-upload' : 'ti-server';
    
    return `
      <div class="node-header">
        <div class="node-title">
          <i class="ti ${icon}"></i>
          ${displayName}
        </div>
        <div class="node-type">Input</div>
      </div>
      <div class="node-content">
        <div class="text-xs">Select input file for your workflow</div>
        <button class="btn w-full" onclick="workflowBuilder.selectFile('${component}', 'input')">
          <i class="ti ti-file-plus mr-1"></i>
          Select File
        </button>
      </div>
    `;
  }

  createFileOutputNode(component) {
    const displayName = component === 'local-folder' ? 'Local Folder' : 'Server Folder';
    const icon = component === 'local-folder' ? 'ti-folder-down' : 'ti-folder-up';
    
    return `
      <div class="node-header">
        <div class="node-title">
          <i class="ti ${icon}"></i>
          ${displayName}
        </div>
        <div class="node-type">Output</div>
      </div>
      <div class="node-content">
        <div class="text-xs">Choose output folder for workflow results</div>
        <button class="btn w-full" onclick="workflowBuilder.selectFile('${component}', 'output')">
          <i class="ti ti-folder-plus mr-1"></i>
          Select Folder
        </button>
      </div>
    `;
  }

  createToolNode(component) {
    const toolIcons = {
      'spades': 'ti-dna-2',
      'quast': 'ti-chart-line',
      'fastqc': 'ti-microscope',
      'cutadapt': 'ti-cut'
    };
    
    const toolDescriptions = {
      'spades': 'De novo genome assembler for bacterial genomes from Next-Gen sequencing data',
      'quast': 'Quality assessment tool for genome assemblies by comparison with reference',
      'fastqc': 'Quality control tool for high throughput sequence data',
      'cutadapt': 'Finds and removes adapter sequences, primers, poly-A tails from reads'
    };
    
    const icon = toolIcons[component] || 'ti-tool';
    const description = toolDescriptions[component] || 'Bioinformatics analysis tool';
    
    return `
      <div class="node-header">
        <div class="node-title">
          <i class="ti ${icon}"></i>
          ${component.toUpperCase()}
        </div>
        <div class="node-type">Tool</div>
      </div>
      <div class="node-content">
        <div class="node-description">${description}</div>
        <button class="btn w-full" onclick="workflowBuilder.configureNode('${component}')">
          <i class="ti ti-settings mr-1"></i>
          Configure Parameters
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
    // Clear existing connection points
    node.querySelectorAll('.node-connection-point').forEach(point => point.remove());
    
    // Add input ports
    inputs.forEach((input, index) => {
      const port = document.createElement('div');
      port.className = 'node-connection-point input';
      port.dataset.port = input;
      port.dataset.type = 'input';
      port.style.position = 'absolute';
      port.style.left = '-7px';
      port.style.top = `${40 + index * 25}px`;  // More spacing for multiple inputs
      
      // Add port label
      const label = document.createElement('span');
      label.className = 'port-label';
      label.textContent = input.replace('_', ' ');
      label.style.cssText = `
        position: absolute;
        left: -60px;
        top: -3px;
        font-size: 10px;
        color: #666;
        background: white;
        padding: 1px 4px;
        border-radius: 3px;
        border: 1px solid #ddd;
        white-space: nowrap;
      `;
      port.appendChild(label);
      port.style.width = '14px';
      port.style.height = '14px';
      port.style.minWidth = '14px';
      port.style.minHeight = '14px';
      port.style.maxWidth = '14px';
      port.style.maxHeight = '14px';
      port.style.borderRadius = '7px';
      port.style.backgroundColor = '#4f46e5';
      port.style.color = '#4f46e5';
      port.style.border = 'none';
      port.style.boxShadow = '0 0 0 2px white, 0 0 0 3px currentColor';
      port.style.cursor = 'crosshair';
      port.style.zIndex = '20';
      port.style.boxSizing = 'border-box';
      port.style.display = 'block';
      port.style.aspectRatio = '1 / 1';
      port.style.flexShrink = '0';
      port.style.overflow = 'hidden';
      port.title = `Input: ${input}`;
      
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
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
      port.style.position = 'absolute';
      port.style.right = '-7px';
      port.style.top = `${40 + index * 25}px`;  // Consistent spacing
      
      // Add port label
      const label = document.createElement('span');
      label.className = 'port-label';
      label.textContent = output.replace('_', ' ');
      label.style.cssText = `
        position: absolute;
        right: -60px;
        top: -3px;
        font-size: 10px;
        color: #666;
        background: white;
        padding: 1px 4px;
        border-radius: 3px;
        border: 1px solid #ddd;
        white-space: nowrap;
      `;
      port.appendChild(label);
      port.style.width = '14px';
      port.style.height = '14px';
      port.style.minWidth = '14px';
      port.style.minHeight = '14px';
      port.style.maxWidth = '14px';
      port.style.maxHeight = '14px';
      port.style.borderRadius = '7px';
      port.style.backgroundColor = '#059669';
      port.style.color = '#059669';
      port.style.border = 'none';
      port.style.boxShadow = '0 0 0 2px white, 0 0 0 3px currentColor';
      port.style.cursor = 'crosshair';
      port.style.zIndex = '20';
      port.style.boxSizing = 'border-box';
      port.style.display = 'block';
      port.style.aspectRatio = '1 / 1';
      port.style.flexShrink = '0';
      port.style.overflow = 'hidden';
      port.title = `Output: ${output}`;
      
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.startConnection(node.id, output, 'output');
      });
      
      node.appendChild(port);
    });
    
    console.log(`Added ${inputs.length} input ports and ${outputs.length} output ports to ${node.id}`);
    
    // Force circular shape - additional safety check
    setTimeout(() => {
      const allPorts = node.querySelectorAll('.node-connection-point');
      allPorts.forEach(port => {
        port.style.width = '14px';
        port.style.height = '14px';
        port.style.borderRadius = '7px';
        port.style.boxSizing = 'border-box';
        port.style.aspectRatio = '1 / 1';
        port.style.border = 'none';
        port.style.flexShrink = '0';
        port.style.overflow = 'hidden';
      });
    }, 10);
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
      
      // Calculate new position
      let newX = startLeft + deltaX;
      let newY = startTop + deltaY;
      
      // Get canvas boundaries
      const canvasRect = this.canvas.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const nodeWidth = 200; // Fixed width as per CSS
      const nodeHeight = nodeRect.height || 100; // Estimated height
      
      // Apply boundary constraints
      const minX = 10; // Small margin from left
      const minY = 10; // Small margin from top
      const maxX = this.canvas.offsetWidth - nodeWidth - 10; // Margin from right
      const maxY = this.canvas.offsetHeight - nodeHeight - 10; // Margin from bottom
      
      // Constrain position within boundaries
      newX = Math.max(minX, Math.min(maxX, newX));
      newY = Math.max(minY, Math.min(maxY, newY));
      
      node.style.left = `${newX}px`;
      node.style.top = `${newY}px`;
      
      // Update node data
      const nodeData = this.nodes.get(node.id);
      if (nodeData) {
        nodeData.x = newX;
        nodeData.y = newY;
      }
      
      // Update connections in real-time but throttle to avoid infinite loops
      if (!this.updateThrottled) {
        this.updateThrottled = true;
        requestAnimationFrame(() => {
      this.updateConnections(node.id);
          this.updateThrottled = false;
        });
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        node.style.cursor = 'grab';
      }
    });
  }

  startConnection(nodeId, port, type) {
    console.log('startConnection called:', { nodeId, port, type });
    this.connectingFrom = { nodeId, port, type };
    
    // Add temporary connection path (curved line)
    this.tempConnection = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempConnection.setAttribute('class', 'workflow-connection temp-connection');
    this.tempConnection.setAttribute('stroke-dasharray', '5,5');
    this.tempConnection.style.pointerEvents = 'none'; // Temp connections don't need events
    this.svg.appendChild(this.tempConnection);
    
    // Enter connection mode
    document.body.classList.add('connecting');
    document.body.style.cursor = 'crosshair';
    
    // Highlight compatible connection points
    this.highlightCompatiblePorts(type);
    
    this.boundUpdateTempConnection = this.updateTempConnection.bind(this);
    this.boundEndConnection = this.endConnection.bind(this);
    
    document.addEventListener('mousemove', this.boundUpdateTempConnection);
    document.addEventListener('mouseup', this.boundEndConnection);
  }

  highlightCompatiblePorts(connectingType) {
    const allPorts = document.querySelectorAll('.node-connection-point');
    allPorts.forEach(port => {
      const portType = port.dataset.type;
      const portNode = port.closest('.workflow-node');
      
      // Don't highlight ports on the same node
      if (portNode.id === this.connectingFrom.nodeId) {
        port.classList.add('incompatible');
        return;
      }
      
      // Highlight compatible ports: input connects to output, output connects to input
      const basicCompatible = (connectingType === 'output' && portType === 'input') ||
                             (connectingType === 'input' && portType === 'output');
      
      if (basicCompatible) {
        // Check semantic compatibility for workflow
        const currentPortName = this.connectingFrom.port;
        const targetPortName = port.dataset.port;
        let semanticCompatible = true;
        
        if (currentPortName === 'contigs' && targetPortName !== 'contigs') {
          semanticCompatible = false; // contigs can only connect to contigs
        } else if (targetPortName === 'contigs' && currentPortName !== 'contigs') {
          semanticCompatible = false;
        }
        
        if (semanticCompatible) {
          port.classList.add('compatible');
        } else {
          port.classList.add('incompatible');
        }
      } else {
        port.classList.add('incompatible');
      }
    });
  }

  clearPortHighlights() {
    const allPorts = document.querySelectorAll('.node-connection-point');
    allPorts.forEach(port => {
      port.classList.remove('compatible', 'incompatible');
    });
  }

  updateTempConnection(e) {
    if (!this.connectingFrom || !this.tempConnection) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const toX = e.clientX - rect.left;
    const toY = e.clientY - rect.top;
    
    const fromNode = document.getElementById(this.connectingFrom.nodeId);
    const fromPort = fromNode.querySelector(`[data-port="${this.connectingFrom.port}"]`);
    const fromRect = fromPort.getBoundingClientRect();
    const fromX = fromRect.left + fromRect.width / 2 - rect.left;
    const fromY = fromRect.top + fromRect.height / 2 - rect.top;
    
    // Create curved path for temporary connection
    const distance = Math.abs(toX - fromX);
    const controlOffset = Math.max(100, distance * 0.5);
    let path;
    
    if (this.connectingFrom.type === 'output') {
      // Output port - curve rightward
      const controlX1 = fromX + controlOffset;
      const controlX2 = toX - controlOffset;
      path = `M ${fromX} ${fromY} C ${controlX1} ${fromY} ${controlX2} ${toY} ${toX} ${toY}`;
    } else {
      // Input port - curve leftward
      const controlX1 = fromX - controlOffset;
      const controlX2 = toX + controlOffset;
      path = `M ${fromX} ${fromY} C ${controlX1} ${fromY} ${controlX2} ${toY} ${toX} ${toY}`;
    }
    
    this.tempConnection.setAttribute('d', path);
  }

  endConnection(e) {
    if (!this.connectingFrom) return;
    
    console.log('endConnection triggered, event target:', e.target);
    
    // Try to find connection point from mouse position
    let target = null;
    if (e.target && typeof e.target.closest === 'function') {
      target = e.target.closest('.node-connection-point');
    }
    
    // If no direct target, try to find one at the mouse position
    if (!target) {
      const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
      target = elementsAtPoint.find(el => el.classList.contains('node-connection-point'));
    }
    
    console.log('Found target connection point:', target);
    
    // Check if we can connect: one must be input, other must be output
    const canConnect = target && 
                      target.dataset.type !== this.connectingFrom.type && 
                      ((target.dataset.type === 'input' && this.connectingFrom.type === 'output') ||
                       (target.dataset.type === 'output' && this.connectingFrom.type === 'input'));
    
    console.log('Connection compatibility:', {
      target: target?.dataset.type,
      from: this.connectingFrom.type,
      canConnect: canConnect
    });
    
    if (canConnect) {
      const targetNode = target.closest('.workflow-node');
      console.log('Target node:', targetNode);
      
      if (targetNode && targetNode.id !== this.connectingFrom.nodeId) {
      const targetNodeId = targetNode.id;
      const targetPort = target.dataset.port;
      
        console.log('Attempting connection:', {
          from: this.connectingFrom,
          to: { nodeId: targetNodeId, port: targetPort, type: target.dataset.type }
        });
        
        // Check if connection already exists
        const existingConnection = this.findExistingConnection(
          this.connectingFrom.nodeId,
          this.connectingFrom.port,
          targetNodeId,
          targetPort
        );
        
        if (!existingConnection) {
          console.log('Creating new connection...');
      this.createConnection(
        this.connectingFrom.nodeId,
        this.connectingFrom.port,
        targetNodeId,
        targetPort
      );
        } else {
          console.log('Connection already exists');
        }
      } else {
        console.log('Invalid target node or same node');
      }
    } else {
      console.log('No valid target or incompatible types');
    }
    
    // Clean up
    if (this.tempConnection) {
      this.tempConnection.remove();
      this.tempConnection = null;
    }
    
    // Exit connection mode
    document.body.classList.remove('connecting');
    document.body.style.cursor = '';
    this.clearPortHighlights();
    
    this.connectingFrom = null;
    if (this.boundUpdateTempConnection) {
      document.removeEventListener('mousemove', this.boundUpdateTempConnection);
      this.boundUpdateTempConnection = null;
    }
    if (this.boundEndConnection) {
      document.removeEventListener('mouseup', this.boundEndConnection);
      this.boundEndConnection = null;
    }
  }

  findExistingConnection(fromNodeId, fromPort, toNodeId, toPort) {
    for (let [connectionId, connection] of this.connections) {
      if ((connection.fromNode === fromNodeId && connection.fromPort === fromPort && 
           connection.toNode === toNodeId && connection.toPort === toPort) ||
          (connection.fromNode === toNodeId && connection.fromPort === toPort && 
           connection.toNode === fromNodeId && connection.toPort === fromPort)) {
        return connectionId;
      }
    }
    return null;
  }

  createConnection(fromNodeId, fromPort, toNodeId, toPort) {
    const connectionId = `connection_${++this.connectionCounter}`;
    
    const connection = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    connection.setAttribute('class', 'workflow-connection');
    connection.id = connectionId;
    connection.style.pointerEvents = 'stroke'; // Enable click events on the stroke
    
    // Add click handler for connection deletion
    connection.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Delete this connection?')) {
        this.deleteConnection(connectionId);
      }
    });
    
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
    console.log(`Updating connection path: ${connectionId}`);
    
    const connection = document.getElementById(connectionId);
    const fromNode = document.getElementById(fromNodeId);
    const toNode = document.getElementById(toNodeId);
    
    if (!connection || !fromNode || !toNode) {
      console.log('Missing elements:', { connection: !!connection, fromNode: !!fromNode, toNode: !!toNode });
      return;
    }
    
    // Find the correct port elements based on connection data
    const connectionData = this.connections.get(connectionId);
    let fromPortElement, toPortElement;
    
    if (connectionData) {
      // We know which node should be output and which should be input
      // The connection was created as fromNode(output) -> toNode(input)
      fromPortElement = fromNode.querySelector(`[data-port="${fromPort}"][data-type="output"]`);
      toPortElement = toNode.querySelector(`[data-port="${toPort}"][data-type="input"]`);
    } else {
      // Fallback to first match
      fromPortElement = fromNode.querySelector(`[data-port="${fromPort}"]`);
      toPortElement = toNode.querySelector(`[data-port="${toPort}"]`);
    }
    
    if (!fromPortElement || !toPortElement) return;
    
    const rect = this.canvas.getBoundingClientRect();
    const fromRect = fromPortElement.getBoundingClientRect();
    const toRect = toPortElement.getBoundingClientRect();
    
    const fromX = fromRect.left + fromRect.width / 2 - rect.left;
    const fromY = fromRect.top + fromRect.height / 2 - rect.top;
    const toX = toRect.left + toRect.width / 2 - rect.left;
    const toY = toRect.top + toRect.height / 2 - rect.top;
    
    // Create smooth bezier curve
    const distance = Math.abs(toX - fromX);
    const controlOffset = Math.max(100, distance * 0.5);
    
    // Determine port types to set curve direction
    const fromType = fromPortElement.dataset.type;
    const toType = toPortElement.dataset.type;
    
    let path;
    if (fromType === 'output' && toType === 'input') {
      // Output to Input - create smooth S-curve
      const controlX1 = fromX + controlOffset;
      const controlX2 = toX - controlOffset;
      path = `M ${fromX} ${fromY} C ${controlX1} ${fromY} ${controlX2} ${toY} ${toX} ${toY}`;
    } else if (fromType === 'input' && toType === 'output') {
      // Input to Output - reverse direction
      const controlX1 = fromX - controlOffset;
      const controlX2 = toX + controlOffset;
      path = `M ${fromX} ${fromY} C ${controlX1} ${fromY} ${controlX2} ${toY} ${toX} ${toY}`;
    } else {
      // Fallback to simple bezier for same-type connections
    const controlX = (fromX + toX) / 2;
      path = `M ${fromX} ${fromY} C ${controlX} ${fromY} ${controlX} ${toY} ${toX} ${toY}`;
    }
    
    // Only log once per connection to avoid spam
    if (!connection._logged) {
      console.log('Connection path calculated:', {
        from: { x: fromX, y: fromY, type: fromType },
        to: { x: toX, y: toY, type: toType },
        path: path
      });
      connection._logged = true;
    }
    
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

  deleteConnection(connectionId) {
    const connectionElement = document.getElementById(connectionId);
    if (connectionElement) {
      connectionElement.remove();
    }
    this.connections.delete(connectionId);
    console.log(`Deleted connection: ${connectionId}`);
  }

  selectNode(node) {
    this.deselectAll();
    node.classList.add('selected');
    this.selectedNode = node;
    this.showNodeProperties(node);
    this.updateDeleteButtonState();
  }

  deselectAll() {
    document.querySelectorAll('.workflow-node').forEach(node => {
      node.classList.remove('selected');
    });
    this.selectedNode = null;
    this.hideProperties();
    this.updateDeleteButtonState();
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

  deleteSelectedNode() {
    if (!this.selectedNode) {
      alert('Select a component on the canvas to delete.');
      return;
    }
    const nodeId = typeof this.selectedNode === 'string' ? this.selectedNode : this.selectedNode.id;
    if (!nodeId) {
      console.warn('Selected node has no id, cannot delete.');
      return;
    }
    this.deleteNode(nodeId);
  }

  deleteNode(nodeOrId) {
    const nodeId = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId?.id;
    if (!nodeId) {
      console.warn('Invalid node id for deletion:', nodeOrId);
      return;
    }

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
    
    // Update placeholder visibility
    this.updateCanvasPlaceholder();
    this.updateDeleteButtonState();
  }

  updateDeleteButtonState() {
    const btn = document.getElementById('delete-selected');
    if (btn) {
      btn.disabled = !this.selectedNode;
    }
  }

  clearCanvas() {
    if (confirm('Are you sure you want to clear the entire workflow?')) {
      this.nodes.clear();
      this.connections.clear();
      this.canvas.innerHTML = `
        <div id="canvas-placeholder" class="absolute inset-0 flex items-center justify-center text-base-content/50">
          <div class="text-center">
            <i class="ti ti-mouse text-4xl mb-2"></i>
            <p>Drag components from the left panel to start building your workflow</p>
          </div>
        </div>
      `;
      this.setupCanvas();
      this.deselectAll();
      this.updateCanvasPlaceholder();
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

  async configureNode(component, nodeId = null) {
    try {
      // Find the node ID if not provided
      if (!nodeId) {
        // Find the node by component type (assuming only one of each type for now)
        for (let [id, node] of this.nodes) {
          if (node.component === component) {
            nodeId = id;
            break;
          }
        }
      }
      
      if (!nodeId) {
        console.error('Could not find node for component:', component);
        return;
      }
      
      this.currentSelectedNode = nodeId;
      
      const response = await fetch(`/api/tool-config/${component}`);
      if (!response.ok) {
        throw new Error(`Failed to load configuration for ${component}`);
      }
      
      const toolConfig = await response.json();
      this.showConfigurationModal(component, toolConfig);
    } catch (error) {
      console.error('Error loading tool configuration:', error);
      alert(`Error loading configuration for ${component}`);
    }
  }

  selectFile(component, type) {
    console.log('Selecting file for:', component, 'type:', type);
    
    if (type === 'input') {
      // For input files
      if (component === 'local-file') {
        // Create file input element
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.fastq,.fastq.gz,.fasta,.fa,.fna';
        fileInput.onchange = (e) => {
          const file = e.target.files[0];
          if (file) {
            console.log('Selected local file:', file.name);
            this.updateNodeWithFile(component, file.name, 'local');
          }
        };
        fileInput.click();
      } else if (component === 'server-file') {
        // Open server file browser
        this.openServerFileBrowser('input');
      }
    } else if (type === 'output') {
      // For output folders
      if (component === 'local-folder') {
        // For local folder, use directory picker if available
        if ('showDirectoryPicker' in window) {
          window.showDirectoryPicker()
            .then(dirHandle => {
              console.log('Selected local folder:', dirHandle.name);
              this.updateNodeWithFile(component, dirHandle.name, 'local');
            })
            .catch(err => console.log('User cancelled folder selection'));
        } else {
          // Fallback: ask user to input folder path
          const folderPath = prompt('Enter local output folder path:');
          if (folderPath) {
            this.updateNodeWithFile(component, folderPath, 'local');
          }
        }
      } else if (component === 'server-folder') {
        // Open server folder browser
        this.openServerFileBrowser('output');
      }
    }
  }

  updateNodeWithFile(component, fileName, location) {
    console.log('Updating node with file:', { component, fileName, location });
    
    // Find the node with this component
    const nodes = document.querySelectorAll('[data-component="' + component + '"]');
    console.log('Found nodes:', nodes.length);
    
    if (nodes.length > 0) {
      const node = nodes[nodes.length - 1]; // Get the most recently created node
      console.log('Target node:', node);
      console.log('Node HTML:', node.innerHTML);
      console.log('Node classes:', node.className);
      
      // Try multiple selectors to find the content and button
      let contentDiv = node.querySelector('.node-content .text-xs');
      if (!contentDiv) {
        contentDiv = node.querySelector('.text-xs');
      }
      
      let button = node.querySelector('.node-content .btn');
      if (!button) {
        button = node.querySelector('.btn');
      }
      
      console.log('Content div:', contentDiv);
      console.log('Button:', button);
      
      if (contentDiv && button) {
        // Update the display text
        contentDiv.textContent = `Selected: ${fileName}`;
        contentDiv.style.color = '#16a34a';
        contentDiv.style.fontWeight = '500';
        contentDiv.style.fontSize = '0.75rem';
        
        // Update button to show change option
        button.innerHTML = `<i class="ti ti-edit mr-1"></i>Change`;
        
        // Add a visual indicator that file is selected
        node.style.borderColor = '#16a34a';
        node.style.borderWidth = '2px';
        
        console.log('✅ Node updated successfully');
      } else {
        console.warn('❌ Could not find content div or button');
        
        // Fallback: try to find any text element to update
        const anyTextElement = node.querySelector('.text-xs');
        const anyButton = node.querySelector('.btn');
        
        if (anyTextElement) {
          anyTextElement.textContent = `Selected: ${fileName}`;
          anyTextElement.style.color = '#16a34a';
          anyTextElement.style.fontWeight = '500';
        }
        
        if (anyButton) {
          anyButton.innerHTML = `<i class="ti ti-edit mr-1"></i>Change`;
        }
        
        // Add visual feedback even in fallback
        node.style.borderColor = '#16a34a';
        node.style.borderWidth = '2px';
        
        console.log('⚠️ Used fallback update method');
      }
    } else {
      console.error('❌ No nodes found with component:', component);
    }
  }

  openServerFileBrowser(type) {
    console.log('Opening server file browser for:', type);
    this.createSimpleFileModal(type);
  }

  createSimpleFileModal(type) {
    // Remove existing modal
    const existingModal = document.getElementById('simple-file-modal');
    if (existingModal) {
      existingModal.remove();
    }

    // Create simple modal HTML
    const modalHTML = `
      <div id="simple-file-modal" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      ">
        <div style="
          background: white;
          border-radius: 8px;
          width: 90%;
          max-width: 800px;
          max-height: 80%;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        ">
          <!-- Header -->
          <div style="
            padding: 16px;
            border-bottom: 1px solid #e5e7eb;
            display: flex;
            justify-content: space-between;
            align-items: center;
          ">
            <h3 style="margin: 0; font-size: 18px; font-weight: 600;">
              Select Server ${type === 'input' ? 'File' : 'Folder'}
            </h3>
            <button onclick="document.getElementById('simple-file-modal').remove()" style="
              background: none;
              border: none;
              font-size: 24px;
              cursor: pointer;
              color: #6b7280;
            ">&times;</button>
          </div>

          <!-- Path Navigation -->
          <div style="padding: 12px 16px; background: #f9fafb; border-bottom: 1px solid #e5e7eb;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <button id="back-btn" onclick="window.workflowBuilder.goBackFolder()" style="
                padding: 4px 8px;
                background: #e5e7eb;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
              " disabled>← Back</button>
              <span id="current-path" style="font-size: 14px; color: #6b7280;">/</span>
            </div>
          </div>

          <!-- File List -->
          <div id="file-list-container" style="
            height: 400px;
            overflow-y: auto;
            padding: 16px;
          ">
            <div style="text-align: center; padding: 40px;">
              <div style="font-size: 14px; color: #6b7280;">Loading...</div>
            </div>
          </div>

          <!-- Footer -->
          <div style="
            padding: 16px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            justify-content: space-between;
            align-items: center;
          ">
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <div id="selected-info" style="font-size: 14px; color: #6b7280;">
                Please select a ${type === 'input' ? 'file' : 'folder'}
              </div>
              ${type === 'output' ? `
                <button onclick="window.workflowBuilder.selectCurrentDirectory()" style="
                  padding: 6px 12px;
                  background: #10b981;
                  color: white;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 13px;
                ">📁 Use Current Directory</button>
              ` : ''}
            </div>
            <div style="display: flex; gap: 8px;">
              <button onclick="document.getElementById('simple-file-modal').remove()" style="
                padding: 8px 16px;
                background: #e5e7eb;
                border: none;
                border-radius: 4px;
                cursor: pointer;
              ">Cancel</button>
              <button id="confirm-btn" onclick="window.workflowBuilder.confirmFileSelection()" style="
                padding: 8px 16px;
                background: #3b82f6;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
              " disabled>Confirm</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Initialize
    this.currentPath = '/';
    this.selectedFile = null;
    this.browserType = type;

    // Load file list
    this.loadSimpleFileList('/');
  }

  async loadSimpleFileList(path) {
    this.currentPath = path;
    document.getElementById('current-path').textContent = path;
    document.getElementById('back-btn').disabled = (path === '/');

    const container = document.getElementById('file-list-container');
    container.innerHTML = '<div style="text-align: center; padding: 40px;"><div style="font-size: 14px; color: #6b7280;">Loading...</div></div>';

    try {
      const response = await fetch(`/browse-remote-files?dir=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error('Failed to load');
      
      const data = await response.json();
      this.renderSimpleFileList(data.files || []);
    } catch (error) {
      container.innerHTML = `<div style="text-align: center; padding: 40px; color: #ef4444;">Failed to load: ${error.message}</div>`;
    }
  }

  renderSimpleFileList(files) {
    const container = document.getElementById('file-list-container');
    
    if (files.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 40px; color: #6b7280;">Folder is empty</div>';
      return;
    }

    let html = '';
    files.forEach(file => {
      const canSelect = this.browserType === 'input' ? !file.isDirectory : file.isDirectory;
      const iconColor = file.isDirectory ? '#f59e0b' : '#3b82f6';
      const icon = file.isDirectory ? '📁' : '📄';
      
      html += `
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px;
          border: 1px solid #e5e7eb;
          border-radius: 4px;
          margin-bottom: 4px;
          cursor: pointer;
          ${canSelect ? 'background: #f8fafc;' : 'opacity: 0.6;'}
        " 
        onmouseover="this.style.background='#f3f4f6'"
        onmouseout="this.style.background='${canSelect ? '#f8fafc' : 'white'}'"
        ${file.isDirectory ? `ondblclick="window.workflowBuilder.openFolder('${file.fullPath}')"` : ''}
        ${canSelect ? `onclick="window.workflowBuilder.selectSimpleFile('${file.fullPath}', '${file.filename}')"` : ''}
        >
          <div style="display: flex; align-items: center;">
            <span style="font-size: 20px; margin-right: 8px;">${icon}</span>
            <div>
              <div style="font-weight: 500;">${file.filename}</div>
              <div style="font-size: 12px; color: #6b7280;">${file.size || '-'} • ${file.date || '-'}</div>
            </div>
          </div>
          <div>
      `;
      
      if (file.isDirectory) {
        html += `<button onclick="event.stopPropagation(); window.workflowBuilder.openFolder('${file.fullPath}')" style="
          padding: 4px 8px;
          background: #10b981;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          margin-right: 4px;
        ">Open</button>`;
        
        // For output type, add select folder button
        if (this.browserType === 'output') {
          html += `<button onclick="event.stopPropagation(); window.workflowBuilder.selectSimpleFile('${file.fullPath}', '${file.filename}')" style="
            padding: 4px 8px;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
          ">Select</button>`;
        }
      } else if (this.browserType === 'input') {
        html += `<button onclick="event.stopPropagation(); window.workflowBuilder.selectSimpleFile('${file.fullPath}', '${file.filename}')" style="
          padding: 4px 8px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        ">Select</button>`;
      }
      
      html += '</div></div>';
    });
    
    container.innerHTML = html;
  }

  openFolder(path) {
    this.loadSimpleFileList(path);
  }

  goBackFolder() {
    if (this.currentPath === '/') return;
    const parentPath = this.currentPath.split('/').slice(0, -1).join('/') || '/';
    this.loadSimpleFileList(parentPath);
  }

  selectSimpleFile(filePath, fileName) {
    this.selectedFile = { path: filePath, name: fileName };
    
    // Clear previous selection
    document.querySelectorAll('#file-list-container > div').forEach(item => {
      item.style.background = item.style.background === 'rgb(243, 244, 246)' ? '#f8fafc' : 'white';
    });
    
    // Highlight current selection
    event.currentTarget.style.background = '#dbeafe';
    
    // Update UI
    document.getElementById('selected-info').textContent = `Selected: ${fileName}`;
    document.getElementById('confirm-btn').disabled = false;
    document.getElementById('confirm-btn').style.background = '#3b82f6';
  }

  selectCurrentDirectory() {
    const currentPath = this.currentPath || '/';
    const folderName = currentPath === '/' ? 'root' : currentPath.split('/').pop();
    
    this.selectedFile = { 
      path: currentPath, 
      name: folderName,
      isCurrentDir: true 
    };
    
    // Clear file selection highlight
    document.querySelectorAll('#file-list-container > div').forEach(item => {
      item.style.background = item.style.background === 'rgb(243, 244, 246)' ? '#f8fafc' : 'white';
    });
    
    // Update UI
    document.getElementById('selected-info').textContent = `Selected current directory: ${currentPath}`;
    document.getElementById('confirm-btn').disabled = false;
    document.getElementById('confirm-btn').style.background = '#3b82f6';
    
    console.log('Selected current directory:', currentPath);
  }

  confirmFileSelection() {
    if (!this.selectedFile) return;
    
    // Update node
    this.updateNodeWithFile(
      this.browserType === 'input' ? 'server-file' : 'server-folder',
      this.selectedFile.name,
      'server'
    );
    
    // Close modal
    document.getElementById('simple-file-modal').remove();
  }


  showConfigurationModal(component, toolConfig) {
    const modal = document.getElementById('component-config-modal');
    const content = document.getElementById('component-config-content');
    
    // Store current node ID for saving configuration
    modal.setAttribute('data-node-id', this.currentSelectedNode);
    
    let parametersHtml = '';
    
    if (toolConfig.parameters && Array.isArray(toolConfig.parameters)) {
      const categories = {};
      
      // Group parameters by category
      toolConfig.parameters.forEach(param => {
        const category = param.category || 'Other';
        if (!categories[category]) {
          categories[category] = [];
        }
        categories[category].push(param);
      });
      
      // Generate HTML for each category
      Object.entries(categories).forEach(([category, params]) => {
        parametersHtml += `
          <div class="collapse collapse-arrow bg-base-100 mb-2">
            <input type="checkbox" ${category === 'Basic options' ? 'checked' : ''}>
            <div class="collapse-title text-sm font-medium">
              ${category}
            </div>
            <div class="collapse-content">
              <div class="space-y-3">
        `;
        
        params.forEach(param => {
          const paramId = `param_${param.short || param.long || 'unknown'}`.replace(/[^a-zA-Z0-9]/g, '_');
          const paramLabel = param.short || param.long || 'Parameter';
          const isRequired = param.required ? 'required' : '';
          const defaultValue = param.default || '';
          
          if (param.needs_input) {
            if (param.category === 'Environment' && paramLabel.includes('conda-env')) {
              // Special handling for conda environment with dropdown
              parametersHtml += `
                <div class="form-control border-2 border-primary/20 rounded-lg p-3 bg-primary/5">
                  <label class="label">
                    <span class="label-text font-semibold text-primary">🐍 ${paramLabel} ${param.required ? '*' : ''}</span>
                    <button type="button" class="btn btn-xs btn-primary" onclick="loadCondaEnvironments('${paramId}')">
                      <i class="ti ti-refresh mr-1"></i>Refresh
                    </button>
                  </label>
                  <div class="flex gap-2">
                    <select id="${paramId}_select" 
                            class="select select-bordered select-sm flex-1" 
                            onchange="updateCondaEnvInput('${paramId}')">
                      <option value="">Select conda environment...</option>
                    </select>
                    <input type="text" 
                           id="${paramId}" 
                           class="input input-bordered input-sm input-primary flex-1" 
                           placeholder="${param.description}"
                           value="${defaultValue}"
                           ${isRequired}>
                  </div>
                  <label class="label">
                    <span class="label-text-alt text-primary/70">
                      ⚠️ Select from dropdown or manually enter environment name
                    </span>
                  </label>
                </div>
              `;
            } else {
              parametersHtml += `
                <div class="form-control">
                  <label class="label">
                    <span class="label-text">${paramLabel} ${param.required ? '*' : ''}</span>
                  </label>
                  <input type="text" 
                         id="${paramId}" 
                         class="input input-bordered input-sm" 
                         placeholder="${param.description}"
                         value="${defaultValue}"
                         ${isRequired}>
                  <label class="label">
                    <span class="label-text-alt">${param.description}</span>
                  </label>
                </div>
              `;
            }
          } else {
            // Checkbox for boolean parameters
            parametersHtml += `
              <div class="form-control">
                <label class="label cursor-pointer justify-start gap-2">
                  <input type="checkbox" 
                         id="${paramId}" 
                         class="checkbox checkbox-sm">
                  <span class="label-text">${paramLabel}</span>
                </label>
                <label class="label">
                  <span class="label-text-alt">${param.description}</span>
                </label>
              </div>
            `;
          }
        });
        
        parametersHtml += `
              </div>
            </div>
          </div>
        `;
      });
    }
    
    // Add workflow-specific hints
    let workflowHints = '';
    if (component === 'spades') {
      workflowHints = `
        <div class="alert alert-info mb-4">
          <i class="ti ti-info-circle"></i>
          <div>
            <div class="font-semibold">SPAdes Workflow Tips:</div>
            <div class="text-sm">
              • Ensure -1 and -2 parameters point to correct paired-end reads files<br>
              • Output directory (-o) will contain contigs.fasta file for QUAST<br>
              • Recommend using --careful parameter to improve assembly quality
            </div>
          </div>
        </div>
      `;
    } else if (component === 'quast') {
      workflowHints = `
        <div class="alert alert-info mb-4">
          <i class="ti ti-chart-line"></i>
          <div>
            <div class="font-semibold">QUAST Workflow Tips:</div>
            <div class="text-sm">
              • Contigs parameter will automatically connect to SPAdes output files<br>
              • Output directory (-o) will contain detailed quality assessment reports<br>
              • Optionally add reference genome (-r) for more detailed comparison
            </div>
          </div>
        </div>
      `;
    }

    content.innerHTML = `
      <div class="space-y-4">
        <div>
          <h4 class="text-lg font-semibold mb-2">${component.toUpperCase()} Configuration</h4>
          <p class="text-sm text-base-content/70 mb-4">${toolConfig.description || ''}</p>
        </div>
        
        ${workflowHints}
        
        <div class="space-y-2">
          ${parametersHtml}
        </div>
      </div>
    `;
    
    modal.showModal();
    
    // Auto-load conda environments after modal opens
    setTimeout(() => {
      const condaSelects = modal.querySelectorAll('select[id$="_select"]');
      condaSelects.forEach(select => {
        const paramId = select.id.replace('_select', '');
        loadCondaEnvironments(paramId);
      });
    }, 100);
  }

  saveComponentConfig() {
    const modal = document.getElementById('component-config-modal');
    const currentNodeId = modal.getAttribute('data-node-id');
    
    if (!currentNodeId) {
      console.error('No node ID found for configuration');
      return;
    }
    
    const node = this.nodes.get(currentNodeId);
    if (!node) {
      console.error('Node not found:', currentNodeId);
      return;
    }
    
    // Collect all form inputs
    const config = {};
    const inputs = modal.querySelectorAll('input, select, textarea');
    
    inputs.forEach(input => {
      if (input.type === 'checkbox') {
        config[input.id] = input.checked;
      } else if (input.value) {
        config[input.id] = input.value;
      }
    });
    
    // Save configuration to node
    node.config = config;
    console.log('Saved configuration for', node.component, ':', config);
    
    // Close modal
    modal.close();
  }

  async runWorkflow() {
    // Prevent multiple simultaneous executions
    if (this.isRunning) {
      console.log('Workflow is already running, ignoring duplicate request');
      return;
    }
    
    const workflow = this.exportWorkflow();
    if (workflow.nodes.length === 0) {
      alert('No nodes in workflow to run');
      return;
    }
    
    // Set running state
    this.isRunning = true;
    
    try {
      // Check if this is a SPAdes+QUAST workflow
      const hasSpades = workflow.nodes.some(node => node.component === 'spades');
      const hasQuast = workflow.nodes.some(node => node.component === 'quast');
      
      // Run generic workflow system for any tool combination
      console.log('🚀 Running generic workflow with configuration...', workflow);
      await this.runGenericWorkflow(workflow);
    } catch (error) {
      console.error('Error in runWorkflow:', error);
    } finally {
      // Reset running state
      this.isRunning = false;
    }
  }

  async runGenericWorkflow(workflow) {
    console.log('🔧 Running generic workflow system...', workflow);
    
    this.showWorkflowProgressModal();
    this.updateWorkflowProgress('🚀 Analyzing workflow structure...', null);
    
    try {
      // Validate workflow
      if (!workflow.nodes || workflow.nodes.length === 0) {
        throw new Error('No nodes found in workflow');
      }
      
      // Extract tool nodes (exclude file input/output nodes)
      const toolNodes = workflow.nodes.filter(node => node.type === 'tool');
      if (toolNodes.length === 0) {
        throw new Error('No tool nodes found in workflow');
      }
      
      this.updateWorkflowProgress(`📊 Found ${toolNodes.length} tools to execute...`, null);
      
      // Check if tools are configured
      const unconfiguredTools = toolNodes.filter(node => !node.config || Object.keys(node.config).length === 0);
      if (unconfiguredTools.length > 0) {
        this.updateWorkflowProgress(`⚠️ ${unconfiguredTools.length} tools using default parameters. Configure them for custom settings.`, null);
      }
      
      // Build execution plan
      const executionPlan = this.buildExecutionPlan(workflow);
      console.log('Execution plan:', executionPlan);
      
      this.updateWorkflowProgress('🔨 Building commands from node configurations...', null);
      
      // Build commands for each tool
      const commands = await this.buildToolCommands(executionPlan);
      console.log('Generated commands:', commands);
      
      this.updateWorkflowProgress('🖥️ Sending workflow to server for execution...', null);
      
      // Send to server for execution
      const response = await fetch('/api/run-generic-workflow', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workflow: workflow,
          executionPlan: executionPlan,
          commands: commands,
          workingDir: (window.MetaDockConfig && window.MetaDockConfig.workingDir) || '/home/user'
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success && result.jobId) {
        // Workflow started in background
        this.updateWorkflowProgress('🚀 Workflow started in background!', null);
        this.updateWorkflowProgress(`📋 Job ID: ${result.jobId}`, null);
        this.updateWorkflowProgress('💡 You can close this window and continue using MetaDock.', null);
        
        // Add close button and background monitoring
        this.addBackgroundMonitoring(result.jobId);
      } else {
        this.updateWorkflowProgress('❌ Failed to start workflow: ' + (result.error || 'Unknown error'), result);
      }
    } catch (error) {
      console.error('Error running generic workflow:', error);
      
      if (error.message.includes('Unexpected token')) {
        this.updateWorkflowProgress('❌ Connection Error: Please establish server connection first', null);
      } else {
        this.updateWorkflowProgress('❌ Error: ' + error.message, null);
      }
    }
  }

  buildExecutionPlan(workflow) {
    // Simple topological sort based on connections
    const toolNodes = workflow.nodes.filter(node => node.type === 'tool');
    const connections = workflow.connections || [];
    
    // Build dependency graph
    const dependencies = new Map();
    const dependents = new Map();
    
    toolNodes.forEach(node => {
      dependencies.set(node.id, new Set());
      dependents.set(node.id, new Set());
    });
    
    // Add dependencies based on connections
    connections.forEach(conn => {
      const fromNode = workflow.nodes.find(n => n.id === conn.fromNode);
      const toNode = workflow.nodes.find(n => n.id === conn.toNode);
      
      if (fromNode && toNode && fromNode.type === 'tool' && toNode.type === 'tool') {
        dependencies.get(conn.toNode).add(conn.fromNode);
        dependents.get(conn.fromNode).add(conn.toNode);
      }
    });
    
    // Topological sort
    const executionOrder = [];
    const visited = new Set();
    const visiting = new Set();
    
    function visit(nodeId) {
      if (visiting.has(nodeId)) {
        throw new Error(`Circular dependency detected involving node ${nodeId}`);
      }
      if (visited.has(nodeId)) return;
      
      visiting.add(nodeId);
      
      // Visit all dependencies first
      for (const depId of dependencies.get(nodeId)) {
        visit(depId);
      }
      
      visiting.delete(nodeId);
      visited.add(nodeId);
      executionOrder.push(nodeId);
    }
    
    // Visit all nodes
    toolNodes.forEach(node => {
      if (!visited.has(node.id)) {
        visit(node.id);
      }
    });
    
    return executionOrder.map(nodeId => {
      const node = toolNodes.find(n => n.id === nodeId);
      return {
        nodeId: nodeId,
        component: node.component,
        config: node.config || {},
        dependencies: Array.from(dependencies.get(nodeId)),
        dependents: Array.from(dependents.get(nodeId))
      };
    });
  }

  async buildToolCommands(executionPlan) {
    const commands = [];
    
    for (const step of executionPlan) {
      try {
        // Load tool configuration to get parameter definitions
        const response = await fetch(`/api/tool-config/${step.component}`);
        if (!response.ok) {
          throw new Error(`Failed to load configuration for ${step.component}`);
        }
        
        const toolConfig = await response.json();
        const config = step.config;
        
        // Build command from configuration with smart defaults
        let command = step.component + '.py'; // Default command format
        
        // Set appropriate conda environment based on tool
        let condaEnv = config['conda-env'] || config['param_conda_env'];
        if (!condaEnv) {
          // Set tool-specific default environments
          if (step.component === 'spades') {
            condaEnv = 'spades_env';
          } else if (step.component === 'quast') {
            condaEnv = 'quast_env';
          } else {
            condaEnv = 'base';
          }
        }
        
        // Special handling for SPAdes
        if (step.component === 'spades') {
          // Build SPAdes command from configuration
          command = 'spades.py';
          
          // Add input files (support both formats: with and without param_ prefix)
          const input1 = config['1'] || config['param_1'] || 'left.fastq.gz';
          const input2 = config['2'] || config['param_2'] || 'right.fastq.gz';
          const outputDir = config['o'] || config['param_o'] || 'spades_output_folder';
          const careful = config['careful'] || config['param_careful'];
          
          if (input1) {
            command += ` -1 ${input1}`;
          }
          if (input2) {
            command += ` -2 ${input2}`;
          }
          
          // Add output directory
          if (outputDir) {
            command += ` -o ${outputDir}`;
          }
          
          // Add careful mode if enabled
          if (careful === true) {
            command += ` --careful`;
          }
          
          console.log(`Built SPAdes command: ${command} (env: ${condaEnv})`);
        } else if (step.component === 'quast') {
          // Build QUAST command from configuration
          command = 'quast.py';
          
          // Add contigs file (positional argument, not --contigs)
          const contigsFile = config['contigs'] || config['param_contigs'] || 'spades_output_folder/contigs.fasta';
          const outputDir = config['o'] || config['param_o'] || 'quast_output_dir';
          
          if (contigsFile) {
            command += ` ${contigsFile}`;
          }
          
          // Add output directory
          if (outputDir) {
            command += ` -o ${outputDir}`;
          }
          
          console.log(`Built QUAST command: ${command} (env: ${condaEnv})`);
        } else {
          // Generic tool handling
          if (toolConfig.parameters) {
            toolConfig.parameters.forEach(param => {
              const paramId = `param_${param.short || param.long || 'unknown'}`.replace(/[^a-zA-Z0-9]/g, '_');
              const value = config[paramId];
              
              if (value !== undefined && value !== '') {
                if (param.needs_input) {
                  const flag = param.short ? `-${param.short}` : `--${param.long}`;
                  command += ` ${flag} ${value}`;
                } else if (value === true) {
                  const flag = param.short ? `-${param.short}` : `--${param.long}`;
                  command += ` ${flag}`;
                }
              }
            });
          }
          
          // Extract conda environment for generic tools
          condaEnv = config['param_conda_env'] || 'base';
        }
        
        commands.push({
          nodeId: step.nodeId,
          component: step.component,
          command: command,
          condaEnv: condaEnv,
          config: config
        });
        
      } catch (error) {
        console.error(`Error building command for ${step.component}:`, error);
        // Use fallback command
        commands.push({
          nodeId: step.nodeId,
          component: step.component,
          command: `${step.component}.py --help`,
          condaEnv: 'base',
          config: step.config
        });
      }
    }
    
    return commands;
  }

  addBackgroundMonitoring(jobId) {
    // Store the job ID for later reference
    this.lastJobId = jobId;
    
    // Update the existing close button to hide and start polling
    const closeBtn = document.getElementById('close-progress-btn');
    console.log('🔧 Setting up background monitoring button:', closeBtn ? 'found' : 'not found');
    if (closeBtn) {
      closeBtn.disabled = false;
      closeBtn.innerHTML = '<i class="ti ti-eye-off mr-1"></i>Hide & Continue';
      closeBtn.style.background = '#3b82f6';
      closeBtn.style.color = 'white';
      closeBtn.onclick = () => {
        console.log('🎯 Hide & Continue clicked');
        document.getElementById('workflow-progress-modal').style.display = 'none';
        this.startBackgroundPolling(jobId);
      };
      console.log('✅ Background monitoring button configured');
    }
  }

  startBackgroundPolling(jobId) {
    console.log(`Starting background polling for job ${jobId}`);
    
    // Clear any existing polling interval
    if (window.workflowPollingInterval) {
      clearInterval(window.workflowPollingInterval);
    }
    
    const pollInterval = setInterval(async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch(`/api/workflow-status/${jobId}`, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          console.error('Failed to check workflow status:', response.status);
          if (response.status === 404) {
            console.log('Job not found, stopping polling');
            clearInterval(pollInterval);
          }
          return;
        }
        
        const job = await response.json();
        console.log(`Job ${jobId} status:`, job.status, `Progress: ${job.progress}%`);
        
        if (job.status === 'completed' || job.status === 'failed') {
          clearInterval(pollInterval);
          window.workflowPollingInterval = null;
          this.showCompletionNotification(job);
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('Polling request timed out');
        } else {
          console.error('Error polling workflow status:', error);
        }
        // Don't clear interval on timeout, just continue polling
        if (error.name !== 'AbortError') {
          clearInterval(pollInterval);
          window.workflowPollingInterval = null;
        }
      }
    }, 3000); // Poll every 3 seconds
    
    // Store interval ID for cleanup
    window.workflowPollingInterval = pollInterval;
  }

  showCompletionNotification(job) {
    const isSuccess = job.status === 'completed';
    const title = isSuccess ? '✅ Workflow Completed!' : '❌ Workflow Failed!';
    const message = job.message || (isSuccess ? 'Your workflow has finished successfully.' : 'Your workflow encountered an error.');
    
    // Check if progress modal is hidden, if so show notification bar
    const progressModal = document.getElementById('workflow-progress-modal');
    const isModalHidden = !progressModal || progressModal.style.display === 'none';
    
    if (isModalHidden) {
      // Show page notification bar
      try {
        this.showPageNotificationBar(title, message, isSuccess, job);
      } catch (error) {
        console.error('Failed to show page notification:', error);
      }
    } else {
      // Modal is visible, update it with completion status
      this.updateWorkflowProgress(isSuccess ? '✅ Workflow completed successfully!' : '❌ Workflow failed!', job);
      
      // Update the button based on status
      const closeBtn = document.getElementById('close-progress-btn');
      if (closeBtn) {
        closeBtn.disabled = false;
        if (isSuccess) {
          closeBtn.innerHTML = '<i class="ti ti-eye mr-1"></i>View Results';
          closeBtn.style.background = '#10b981';
          closeBtn.style.color = 'white';
          closeBtn.onclick = () => {
            document.getElementById('workflow-progress-modal').remove();
            this.showWorkflowResultsModal(job);
          };
        } else {
          closeBtn.innerHTML = 'Close';
          closeBtn.style.background = '#ef4444';
          closeBtn.style.color = 'white';
          closeBtn.onclick = () => {
            document.getElementById('workflow-progress-modal').remove();
          };
        }
      }
    }
    
    // Always show detailed results modal for completed workflows
    if (isSuccess) {
      // Small delay to ensure progress modal updates are visible first
      setTimeout(() => {
        this.showWorkflowResultsModal(job);
      }, 1000);
    }
  }

  showPageNotificationBar(title, message, isSuccess, job) {
    // Remove any existing notification bar
    const existingBar = document.getElementById('workflow-notification-bar');
    if (existingBar) {
      existingBar.remove();
    }
    
    const notificationHtml = `
      <div id="workflow-notification-bar" class="fixed left-0 right-0 transform transition-transform duration-300 translate-y-0" style="top: 60px; z-index: 9999;">
        <div class="alert ${isSuccess ? 'alert-success' : 'alert-error'} rounded-none shadow-lg">
          <div class="flex items-center justify-between w-full">
            <div class="flex items-center gap-3">
              <span class="text-lg">${isSuccess ? '🎉' : '⚠️'}</span>
              <div>
                <div class="font-semibold">${title}</div>
                <div class="text-sm opacity-90">${message}</div>
                <div class="text-xs opacity-75 mt-1">Job ID: ${job.jobId}</div>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn btn-sm btn-ghost" onclick="window.workflowBuilder.showProgressModal('${job.jobId}')">
                <i class="ti ti-activity mr-1"></i>Show Progress
              </button>
              <button class="btn btn-sm btn-ghost" onclick="window.workflowBuilder.showJobResults('${job.jobId}')">
                <i class="ti ti-eye mr-1"></i>View Details
              </button>
              <button class="btn btn-sm btn-ghost" onclick="document.getElementById('workflow-notification-bar').remove(); document.querySelector('main').style.paddingTop = '';">
                <i class="ti ti-x"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    
    // Add to page
    document.body.insertAdjacentHTML('afterbegin', notificationHtml);
    
    // Add some top padding to the main content to avoid overlap
    const mainContent = document.querySelector('main') || document.body;
    if (mainContent) {
      mainContent.style.paddingTop = '140px';
    }
    
    // Auto-hide after 15 seconds
    setTimeout(() => {
      const bar = document.getElementById('workflow-notification-bar');
      if (bar) {
        bar.style.transform = 'translateY(-100%)';
        setTimeout(() => {
          bar.remove();
          // Remove padding
          if (mainContent) {
            mainContent.style.paddingTop = '';
          }
        }, 300);
      }
    }, 15000);
  }

  async showJobResults(jobId) {
    try {
      const response = await fetch(`/api/workflow-status/${jobId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch job details');
      }
      const job = await response.json();
      this.showWorkflowResultsModal(job);
    } catch (error) {
      console.error('Error fetching job results:', error);
      alert('Failed to load job details');
    }
  }

  async showProgressModal(jobId) {
    console.log('🔍 showProgressModal called with jobId:', jobId);
    try {
      // Fetch current job status
      console.log('🌐 Fetching job status from server...');
      const response = await fetch(`/api/workflow-status/${jobId}`);
      if (!response.ok) {
        console.error('❌ Server response not ok:', response.status, response.statusText);
        throw new Error('Failed to fetch job status');
      }
      const job = await response.json();
      console.log('📊 Received job data:', job);
      
      // Remove existing modal if present
      const existingModal = document.getElementById('workflow-progress-modal');
      if (existingModal) {
        console.log('🗑️ Removing existing modal');
        existingModal.remove();
      }
      
      // Show the progress modal
      console.log('🎭 Creating new progress modal');
      this.showWorkflowProgressModal();
      
      // Clear the default loading content and replace with actual status
      const progressContent = document.getElementById('workflow-progress-content');
      if (progressContent) {
        console.log('🧹 Clearing progress content');
        progressContent.innerHTML = '';
      } else {
        console.error('❌ Progress content element not found');
      }
      
      // Show progress history first if available
      let hasHistory = false;
      if (job.executionResults && job.executionResults.steps && job.executionResults.steps.length > 0) {
        hasHistory = true;
        job.executionResults.steps.forEach((step, index) => {
          this.updateWorkflowProgress(step.message || step.status, null, index > 0);
        });
      }
      
      // Always show current status (even if no history)
      console.log('🔍 Job status:', job.status, 'Has history:', hasHistory);
      
      // If no history, show basic job info first
      if (!hasHistory) {
        this.updateWorkflowProgress(`📋 Job ID: ${jobId}`, null, false);
        this.updateWorkflowProgress(`📊 Status: ${job.status}`, null, true);
        if (job.progress) {
          this.updateWorkflowProgress(`📈 Progress: ${job.progress}`, null, true);
        }
      }
      
      if (job.status === 'completed') {
        this.updateWorkflowProgress('✅ Workflow completed successfully!', job, true);
        // Update button to show results instead of hide
        const closeBtn = document.getElementById('close-progress-btn');
        console.log('🔧 Setting up completed button:', closeBtn ? 'found' : 'not found');
        if (closeBtn) {
          closeBtn.disabled = false;
          closeBtn.innerHTML = '<i class="ti ti-eye mr-1"></i>View Results';
          closeBtn.style.background = '#10b981';
          closeBtn.style.color = 'white';
          closeBtn.onclick = () => {
            console.log('🎯 View Results clicked');
            document.getElementById('workflow-progress-modal').remove();
            this.showWorkflowResultsModal(job);
          };
          console.log('✅ Completed button configured');
        }
      } else if (job.status === 'failed') {
        this.updateWorkflowProgress('❌ Workflow failed: ' + (job.error || 'Unknown error'), job, true);
        // Update button to close
        const closeBtn = document.getElementById('close-progress-btn');
        console.log('🔧 Setting up failed button:', closeBtn ? 'found' : 'not found');
        if (closeBtn) {
          closeBtn.disabled = false;
          closeBtn.innerHTML = 'Close';
          closeBtn.style.background = '#ef4444';
          closeBtn.style.color = 'white';
          closeBtn.onclick = () => {
            console.log('🎯 Close clicked');
            document.getElementById('workflow-progress-modal').remove();
          };
          console.log('✅ Failed button configured');
        }
      } else if (job.status === 'running') {
        this.updateWorkflowProgress(`🔄 Workflow is running... (${job.progress || 'In progress'})`, job, true);
        // Add background monitoring
        this.addBackgroundMonitoring(jobId);
      } else {
        this.updateWorkflowProgress(`📋 Job Status: ${job.status}`, job, true);
        // Add background monitoring for pending jobs
        this.addBackgroundMonitoring(jobId);
      }
      
    } catch (error) {
      console.error('Error showing progress modal:', error);
      alert('Failed to load workflow progress');
    }
  }

  // Method to show the most recent workflow progress
  showLastWorkflowProgress() {
    console.log('🔍 showLastWorkflowProgress called, lastJobId:', this.lastJobId);
    if (this.lastJobId) {
      console.log('🔍 Showing progress for job:', this.lastJobId);
      this.showProgressModal(this.lastJobId);
    } else {
      console.log('❌ No recent workflow found');
      alert('No recent workflow found. Please run a workflow first.');
    }
  }

  // Debug method to test button functionality
  debugButtonState() {
    const closeBtn = document.getElementById('close-progress-btn');
    if (closeBtn) {
      console.log('🔧 Button state:', {
        disabled: closeBtn.disabled,
        innerHTML: closeBtn.innerHTML,
        onclick: closeBtn.onclick ? 'has onclick' : 'no onclick',
        style: {
          background: closeBtn.style.background,
          color: closeBtn.style.color
        }
      });
    } else {
      console.log('❌ Button not found');
    }
  }

  // Force enable button for testing
  forceEnableButton() {
    const closeBtn = document.getElementById('close-progress-btn');
    if (closeBtn) {
      closeBtn.disabled = false;
      closeBtn.innerHTML = '🔧 Test Button';
      closeBtn.style.background = '#3b82f6';
      closeBtn.style.color = 'white';
      closeBtn.onclick = () => {
        console.log('🎯 Test button clicked!');
        alert('Test button works!');
      };
      console.log('✅ Button force enabled');
    } else {
      console.log('❌ Button not found');
    }
  }

  showWorkflowResultsModal(job) {
    const modalHtml = `
      <dialog id="workflow-results-modal" class="modal modal-open">
        <div class="modal-box w-11/12 max-w-4xl">
          <h3 class="font-bold text-lg mb-4">
            ${job.status === 'completed' ? '✅' : '❌'} Workflow Results
          </h3>
          
          <div class="space-y-4">
            <div class="stats shadow">
              <div class="stat">
                <div class="stat-title">Status</div>
                <div class="stat-value text-sm ${job.status === 'completed' ? 'text-success' : 'text-error'}">
                  ${job.status.toUpperCase()}
                </div>
              </div>
              <div class="stat">
                <div class="stat-title">Progress</div>
                <div class="stat-value text-sm">${job.progress}%</div>
              </div>
              <div class="stat">
                <div class="stat-title">Success Rate</div>
                <div class="stat-value text-sm">${job.successfulSteps}/${job.totalSteps}</div>
              </div>
            </div>
            
            <div class="alert ${job.status === 'completed' ? 'alert-success' : 'alert-error'}">
              <span>${job.message}</span>
            </div>
            
            <div class="collapse collapse-arrow bg-base-200">
              <input type="checkbox">
              <div class="collapse-title text-sm font-medium">
                📊 Execution Details
              </div>
              <div class="collapse-content">
                <pre class="text-xs bg-base-100 p-4 rounded overflow-auto max-h-96">${JSON.stringify(job, null, 2)}</pre>
              </div>
            </div>
          </div>
          
          <div class="modal-action">
            <button class="btn btn-outline" onclick="document.getElementById('workflow-results-modal').remove()">Close</button>
            <button class="btn btn-primary" onclick="window.workflowBuilder.downloadWorkflowResults('${job.jobId}')">
              <i class="ti ti-download mr-1"></i>Download Results
            </button>
          </div>
        </div>
      </dialog>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('workflow-results-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  async downloadWorkflowResults(jobId) {
    try {
      console.log('📥 Downloading results for job:', jobId);
      
      // Fetch job data
      const response = await fetch(`/api/workflow-status/${jobId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch job data');
      }
      const job = await response.json();
      
      // Create downloadable content
      const results = {
        jobId: job.jobId,
        status: job.status,
        progress: job.progress,
        message: job.message,
        startTime: job.startTime,
        endTime: job.endTime,
        executionResults: job.executionResults,
        timestamp: new Date().toISOString()
      };
      
      // Create and download file
      const dataStr = JSON.stringify(results, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(dataBlob);
      link.download = `workflow-results-${jobId}.json`;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up object URL
      URL.revokeObjectURL(link.href);
      
      console.log('✅ Results downloaded successfully');
      
    } catch (error) {
      console.error('❌ Error downloading results:', error);
      alert('Failed to download results: ' + error.message);
    }
  }

  async runRealSpadesQuastWorkflow(workflow) {
    console.log('🧬 Running real SPAdes + QUAST workflow with configuration...', workflow);
    
    this.showWorkflowProgressModal();
    this.updateWorkflowProgress('🚀 Starting SPAdes + QUAST workflow...', null);
    
    try {
      // Extract node configurations
      const spadesNode = workflow.nodes.find(node => node.component === 'spades');
      const quastNode = workflow.nodes.find(node => node.component === 'quast');
      
      if (!spadesNode || !quastNode) {
        throw new Error('SPAdes or QUAST node not found in workflow');
      }
      
      // Build SPAdes command from configuration
      const spadesConfig = spadesNode.config || {};
      const quastConfig = quastNode.config || {};
      
      // Extract key parameters
      const workingDir = (window.MetaDockConfig && window.MetaDockConfig.workingDir) || '/home/user'; // From server config
      const spadesEnv = spadesConfig['param_conda_env'] || 'spades_env';
      const quastEnv = quastConfig['param_conda_env'] || 'quast_env';
      
      // Build SPAdes command
      let spadesCmd = 'spades.py';
      if (spadesConfig['param_1']) spadesCmd += ` -1 ${spadesConfig['param_1']}`;
      if (spadesConfig['param_2']) spadesCmd += ` -2 ${spadesConfig['param_2']}`;
      if (spadesConfig['param_o']) spadesCmd += ` -o ${spadesConfig['param_o']}`;
      if (spadesConfig['param_careful']) spadesCmd += ' --careful';
      
      // Build QUAST command
      let quastCmd = 'quast.py';
      if (quastConfig['param_contigs']) {
        quastCmd += ` ${quastConfig['param_contigs']}`;
      } else {
        // Default: use SPAdes output
        const spadesOutput = spadesConfig['param_o'] || 'spades_output_folder';
        quastCmd += ` ${spadesOutput}/contigs.fasta`;
      }
      if (quastConfig['param_o']) quastCmd += ` -o ${quastConfig['param_o']}`;
      if (quastConfig['param_r']) quastCmd += ` -r ${quastConfig['param_r']}`;
      
      console.log('Generated SPAdes command:', spadesCmd);
      console.log('Generated QUAST command:', quastCmd);
      
      const response = await fetch('/api/run-real-spades-quast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workingDir: workingDir,
          spadesEnv: spadesEnv,
          quastEnv: quastEnv,
          spadesCommand: spadesCmd,
          quastCommand: quastCmd,
          workflow: workflow
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        this.updateWorkflowProgress('✅ Workflow completed successfully!', result);
      } else {
        this.updateWorkflowProgress('❌ Workflow failed: ' + result.error, result);
      }
    } catch (error) {
      console.error('Error running real workflow:', error);
      
      if (error.message.includes('Unexpected token')) {
        this.updateWorkflowProgress('❌ Connection Error: Please establish server connection first', null);
      } else {
        this.updateWorkflowProgress('❌ Error: ' + error.message, null);
      }
    }
  }

  async runMockSpadesQuastWorkflow() {
    try {
      console.log('🚀 Starting SPAdes + QUAST mock workflow...');
      
      // Show progress modal
      this.showWorkflowProgressModal();
      
      // Call the mock workflow API
      const response = await fetch('/api/run-mock-spades-quast', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          workingDir: (window.MetaDockConfig && window.MetaDockConfig.workingDir) || '/home/user',
          spadesEnv: 'spades_env',  // Use environment name instead of full path
          quastEnv: 'quast_env'     // Use environment name instead of full path
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        this.updateWorkflowProgress('✅ Workflow completed successfully!', result);
      } else {
        this.updateWorkflowProgress('❌ Workflow failed: ' + result.error, result);
      }
    } catch (error) {
      console.error('Error running mock workflow:', error);
      
      if (error.message.includes('Unexpected token')) {
        this.updateWorkflowProgress('❌ Connection Error: Please establish server connection first', null);
      } else {
        this.updateWorkflowProgress('❌ Error: ' + error.message, null);
      }
    }
  }

  showWorkflowProgressModal() {
    // Check if modal already exists and remove it
    const existingModal = document.getElementById('workflow-progress-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    const modalHtml = `
      <div id="workflow-progress-modal" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          background: white;
          border-radius: 8px;
          width: 90%;
          max-width: 600px;
          max-height: 80%;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        ">
          <div style="
            padding: 20px;
            border-bottom: 1px solid #e5e7eb;
            text-align: center;
          ">
            <h3 style="margin: 0; font-size: 20px; font-weight: 600;">
              🧬 Workflow Execution Progress
            </h3>
          </div>
          
          <div id="workflow-progress-content" style="
            padding: 20px;
            max-height: 400px;
            overflow-y: auto;
          ">
            <!-- Content will be populated by updateWorkflowProgress -->
          </div>
          
          <div style="
            padding: 16px 20px;
            border-top: 1px solid #e5e7eb;
            text-align: right;
          ">
            <button id="close-progress-btn" onclick="document.getElementById('workflow-progress-modal').style.display='none'" style="
              padding: 8px 16px;
              background: #e5e7eb;
              border: none;
              border-radius: 4px;
              cursor: pointer;
            " disabled>Hide</button>
          </div>
        </div>
      </div>
      
      <style>
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  updateWorkflowProgress(message, result, append = true) {
    const content = document.getElementById('workflow-progress-content');
    const closeBtn = document.getElementById('close-progress-btn');
    
    if (content) {
      let progressHtml = `
        <div style="margin-bottom: 16px;">
          <div style="font-size: 16px; font-weight: 500; margin-bottom: 8px; color: #374151;">
            ${message}
          </div>
        </div>
      `;
      
      if (result) {
        progressHtml += `
          <div style="margin-top: 20px;">
            <h4 style="margin: 0 0 12px 0; font-size: 16px; font-weight: 600;">
              📊 Execution Details:
            </h4>
            <div style="
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 6px;
              padding: 12px;
              font-family: 'Courier New', monospace;
              font-size: 13px;
              line-height: 1.4;
              white-space: pre-wrap;
              max-height: 200px;
              overflow-y: auto;
            ">
${JSON.stringify(result, null, 2)}
            </div>
          </div>
        `;
      }
      
      if (append && content.innerHTML.trim() !== '') {
        // Append to existing content
        content.insertAdjacentHTML('beforeend', progressHtml);
      } else {
        // Replace content
        content.innerHTML = progressHtml;
      }
      
      // Auto-scroll to bottom
      content.scrollTop = content.scrollHeight;
    }
    
    // Note: Button state is managed by specific methods (addBackgroundMonitoring, showProgressModal, etc.)
    // Don't override button state here unless it's specifically needed
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
    
    // Update placeholder visibility
    this.updateCanvasPlaceholder();
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
  const modal = document.getElementById('component-config-modal');
  const content = document.getElementById('component-config-content');
  
  // Get the currently selected node
  if (!workflowBuilder.selectedNode) {
    alert('No node selected');
    modal.close();
    return;
  }
  
  const nodeData = workflowBuilder.nodes.get(workflowBuilder.selectedNode.id);
  if (!nodeData) {
    alert('Node data not found');
    modal.close();
    return;
  }
  
  // Collect configuration from form
  const config = {};
  const formElements = content.querySelectorAll('input');
  
  formElements.forEach(element => {
    const paramName = element.id.replace('param_', '').replace(/_/g, '-');
    
    if (element.type === 'checkbox') {
      if (element.checked) {
        config[paramName] = true;
      }
    } else if (element.type === 'text' && element.value.trim()) {
      config[paramName] = element.value.trim();
    }
  });
  
  // Save configuration to node
  nodeData.config = config;
  console.log('Saved configuration for', nodeData.component, ':', config);
  
  modal.close();
}

function closeFileBrowser() {
  document.getElementById('file-browser-modal').close();
}

function selectFile() {
  // Implementation for file selection
  document.getElementById('file-browser-modal').close();
}

// WorkflowBuilder initialization is handled by the including page (workflow.ejs)
// No automatic initialization here to prevent duplicate instances 