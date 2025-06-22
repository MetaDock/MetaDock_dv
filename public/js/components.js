// Component Loader for Workflow Builder
class ComponentLoader {
  constructor() {
    this.components = new Map();
    this.loaded = false;
  }

  async loadComponents() {
    if (this.loaded) return;

    try {
      // Load component files
      await this.loadComponentFile('/components/FileInput.js');
      await this.loadComponentFile('/components/FileOutput.js');
      await this.loadComponentFile('/components/ToolComponent.js');
      
      this.loaded = true;
      console.log('Components loaded successfully');
    } catch (error) {
      console.error('Error loading components:', error);
    }
  }

  async loadComponentFile(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = path;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  createComponent(type, config = {}) {
    switch (type) {
      case 'file-input':
        const inputType = config.component === 'server-file' ? 'server' : 'local';
        return new FileInput(inputType);
      case 'file-output':
        const outputType = config.component === 'server-folder' ? 'server' : 'local';
        return new FileOutput(outputType);
      case 'tool':
        return new ToolComponent(config.component);
      case 'visualization':
        return new ToolComponent(config.component); // Reuse ToolComponent for visualization
      default:
        throw new Error(`Unknown component type: ${type}`);
    }
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
  componentLoader.loadComponents();
}); 