// Debug script for workflow functionality
console.log('=== Workflow Debug Script ===');

// Check if required elements exist
function checkElements() {
  const requiredElements = [
    'workflow-canvas',
    'properties-panel',
    'clear-canvas',
    'run-workflow',
    'save-workflow',
    'load-workflow',
    'export-workflow',
    'component-search'
  ];

  const optionalElements = [
    'test-drag'
  ];

  console.log('Checking required elements:');
  requiredElements.forEach(id => {
    const element = document.getElementById(id);
    console.log(`  ${id}: ${element ? '✓ Found' : '✗ Missing'}`);
  });

  console.log('Checking optional elements:');
  optionalElements.forEach(id => {
    const element = document.getElementById(id);
    console.log(`  ${id}: ${element ? '✓ Found' : '○ Not found (optional)'}`);
  });
}

// Check if WorkflowBuilder initializes properly
function checkWorkflowBuilder() {
  console.log('Checking WorkflowBuilder initialization:');
  
  if (window.workflowBuilder) {
    console.log('  ✓ WorkflowBuilder instance exists');
    console.log('  Canvas:', window.workflowBuilder.canvas ? '✓' : '✗');
    console.log('  Properties Panel:', window.workflowBuilder.propertiesPanel ? '✓' : '✗');
    console.log('  Nodes count:', window.workflowBuilder.nodes.size);
    console.log('  Connections count:', window.workflowBuilder.connections.size);
  } else {
    console.log('  ✗ WorkflowBuilder not initialized');
  }
}

// Run checks when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    checkElements();
    checkWorkflowBuilder();
  }, 1000); // Wait a second for everything to load
});

// Check connection points styling
function checkConnectionPoints() {
  console.log('Checking connection points:');
  
  const connectionPoints = document.querySelectorAll('.node-connection-point');
  console.log(`Found ${connectionPoints.length} connection points`);
  
  connectionPoints.forEach((point, index) => {
    const computedStyle = window.getComputedStyle(point);
    console.log(`Connection point ${index}:`, {
      width: computedStyle.width,
      height: computedStyle.height,
      borderRadius: computedStyle.borderRadius,
      position: computedStyle.position,
      display: computedStyle.display,
      boxSizing: computedStyle.boxSizing,
      className: point.className,
      type: point.dataset.type
    });
  });
}

// Force all connection points to be perfectly circular
function forceCircularPorts() {
  console.log('Forcing all connection points to be circular...');
  
  const allPorts = document.querySelectorAll('.node-connection-point');
  console.log(`Found ${allPorts.length} connection points to fix`);
  
  allPorts.forEach((port, index) => {
    // Force styles directly
    port.style.setProperty('width', '16px', 'important');
    port.style.setProperty('height', '16px', 'important');
    port.style.setProperty('border-radius', '50%', 'important');
    port.style.setProperty('min-width', '16px', 'important');
    port.style.setProperty('min-height', '16px', 'important');
    port.style.setProperty('max-width', '16px', 'important');
    port.style.setProperty('max-height', '16px', 'important');
    port.style.setProperty('box-sizing', 'border-box', 'important');
    port.style.setProperty('display', 'block', 'important');
    port.style.setProperty('aspect-ratio', '1 / 1', 'important');
    
    console.log(`Fixed connection point ${index}:`, {
      width: port.style.width,
      height: port.style.height,
      borderRadius: port.style.borderRadius,
      aspectRatio: port.style.aspectRatio
    });
  });
  
  // Also check computed styles
  setTimeout(() => {
    checkConnectionPoints();
  }, 100);
}

// Make functions available globally for manual testing
window.debugWorkflowElements = checkElements;
window.debugWorkflowBuilder = checkWorkflowBuilder;
window.debugConnectionPoints = checkConnectionPoints;
window.forceCircularPorts = forceCircularPorts;
