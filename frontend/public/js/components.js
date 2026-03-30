// Component Loader for Workflow Builder
class ComponentLoader {
  constructor() {
    this.components = new Map();
    this.loaded = false;
  }

  async loadComponents() {
    if (this.loaded) return;

    try {
      // Components are now built into workflow-builder.js
      // No external files needed
      this.loaded = true;
      console.log('Components loaded successfully');
    } catch (error) {
      console.error('Error loading components:', error);
    }
  }

  // loadComponentFile method removed - no longer needed

  createComponent(type, config = {}) {
    // Component creation is now handled by WorkflowBuilder
    console.log(`Creating component: ${type} with config:`, config);
    return {
      type: type,
      config: config
    };
  }

  getComponentConfig(type, componentName) {
    switch (type) {
      case 'file-input':
        return {
          inputs: [],
          outputs: ['file'],
          configurable: true
        };
      case 'file-output':
        return {
          inputs: ['file'],
          outputs: [],
          configurable: true
        };
      case 'tool':
        return {
          inputs: ['file'],
          outputs: ['file'],
          configurable: true
        };
      case 'visualization':
        return {
          inputs: ['file'],
          outputs: [],
          configurable: true
        };
      default:
        return {
          inputs: [],
          outputs: [],
          configurable: false
        };
    }
  }
}

// Global component loader instance
window.componentLoader = new ComponentLoader();

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log('ComponentLoader DOMContentLoaded event fired');
  componentLoader.loadComponents();
}); 