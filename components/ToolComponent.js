// Tool Component for Workflow Builder
class ToolComponent {
  constructor(toolName) {
    this.toolName = toolName;
    this.parameters = {};
    this.element = null;
    this.toolConfig = null;
  }

  async create() {
    const container = document.createElement('div');
    container.className = 'tool-component';
    
    // Load tool configuration
    await this.loadToolConfig();
    
    container.innerHTML = `
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <h3 class="card-title text-lg mb-3">
            <i class="ti ti-tool mr-2"></i>
            ${this.toolName}
          </h3>
          
          <div class="space-y-3">
            <!-- Tool Description -->
            <div class="text-sm text-base-content/70 mb-3">
              ${this.toolConfig?.description || 'Tool configuration'}
            </div>
            
            <!-- Input Files -->
            <div class="form-control">
              <label class="label">
                <span class="label-text">Input Files</span>
              </label>
              <div class="input-group">
                <input 
                  type="text" 
                  class="input input-bordered flex-grow" 
                  placeholder="Connected from file input"
                  readonly
                >
                <button class="btn btn-outline btn-sm" onclick="this.configureInputs()">
                  <i class="ti ti-settings"></i>
                </button>
              </div>
            </div>
            
            <!-- Parameters -->
            <div class="parameters-section">
              <label class="label">
                <span class="label-text">Parameters</span>
              </label>
              <div id="parameters-container" class="space-y-2">
                <!-- Parameters will be loaded dynamically -->
              </div>
            </div>
            
            <!-- Output Configuration -->
            <div class="form-control">
              <label class="label">
                <span class="label-text">Output Files</span>
              </label>
              <div class="input-group">
                <input 
                  type="text" 
                  class="input input-bordered flex-grow" 
                  placeholder="Connected to file output"
                  readonly
                >
                <button class="btn btn-outline btn-sm" onclick="this.configureOutputs()">
                  <i class="ti ti-settings"></i>
                </button>
              </div>
            </div>
            
            <!-- Tool Options -->
            <div class="space-y-2">
              <div class="form-control">
                <label class="label cursor-pointer">
                  <span class="label-text">Skip if Output Exists</span>
                  <input type="checkbox" class="checkbox checkbox-sm" ${this.config?.skipIfExists ? 'checked' : ''}>
                </label>
              </div>
              
              <div class="form-control">
                <label class="label cursor-pointer">
                  <span class="label-text">Continue on Error</span>
                  <input type="checkbox" class="checkbox checkbox-sm" ${this.config?.continueOnError ? 'checked' : ''}>
                </label>
              </div>
              
              <div class="form-control">
                <label class="label cursor-pointer">
                  <span class="label-text">Show Progress</span>
                  <input type="checkbox" class="checkbox checkbox-sm" ${this.config?.showProgress ? 'checked' : ''}>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    this.element = container;
    this.bindEvents();
    this.loadParameters();
    return container;
  }

  async loadToolConfig() {
    try {
      const response = await fetch(`/api/tool-config/${this.toolName}`);
      this.toolConfig = await response.json();
    } catch (error) {
      console.error('Error loading tool config:', error);
      this.toolConfig = {
        name: this.toolName,
        description: 'Tool configuration not available',
        parameters: {}
      };
    }
  }

  bindEvents() {
    const skipIfExists = this.element.querySelectorAll('input[type="checkbox"]')[0];
    const continueOnError = this.element.querySelectorAll('input[type="checkbox"]')[1];
    const showProgress = this.element.querySelectorAll('input[type="checkbox"]')[2];
    
    skipIfExists.onchange = (e) => this.updateSkipIfExists(e.target.checked);
    continueOnError.onchange = (e) => this.updateContinueOnError(e.target.checked);
    showProgress.onchange = (e) => this.updateShowProgress(e.target.checked);
  }

  loadParameters() {
    const container = this.element.querySelector('#parameters-container');
    if (!this.toolConfig?.parameters) {
      container.innerHTML = '<div class="text-center text-base-content/50 text-sm">No parameters available</div>';
      return;
    }

    const parameters = Object.entries(this.toolConfig.parameters);
    if (parameters.length === 0) {
      container.innerHTML = '<div class="text-center text-base-content/50 text-sm">No parameters available</div>';
      return;
    }

    container.innerHTML = parameters.map(([key, param]) => this.createParameterField(key, param)).join('');
  }

  createParameterField(key, param) {
    const fieldId = `param_${this.toolName}_${key}`;
    const currentValue = this.parameters[key] || param.default || '';
    
    let inputHtml = '';
    
    switch (param.type) {
      case 'boolean':
        inputHtml = `
          <input type="checkbox" 
                 class="checkbox checkbox-sm" 
                 id="${fieldId}"
                 ${currentValue ? 'checked' : ''}
                 onchange="this.updateParameter('${key}', this.checked)">
        `;
        break;
        
      case 'select':
        inputHtml = `
          <select class="select select-bordered select-sm" 
                  id="${fieldId}"
                  onchange="this.updateParameter('${key}', this.value)">
            ${param.options.map(option => `
              <option value="${option.value}" ${currentValue === option.value ? 'selected' : ''}>
                ${option.label}
              </option>
            `).join('')}
          </select>
        `;
        break;
        
      case 'number':
        inputHtml = `
          <input type="number" 
                 class="input input-bordered input-sm" 
                 id="${fieldId}"
                 value="${currentValue}"
                 min="${param.min || ''}"
                 max="${param.max || ''}"
                 step="${param.step || '1'}"
                 onchange="this.updateParameter('${key}', parseFloat(this.value))">
        `;
        break;
        
      case 'file':
        inputHtml = `
          <div class="input-group">
            <input type="text" 
                   class="input input-bordered input-sm flex-grow" 
                   id="${fieldId}"
                   value="${currentValue}"
                   placeholder="Select file..."
                   readonly>
            <button class="btn btn-outline btn-sm" onclick="this.selectFile('${key}')">
              <i class="ti ti-folder-open"></i>
            </button>
          </div>
        `;
        break;
        
      default: // text
        inputHtml = `
          <input type="text" 
                 class="input input-bordered input-sm" 
                 id="${fieldId}"
                 value="${currentValue}"
                 placeholder="${param.placeholder || ''}"
                 onchange="this.updateParameter('${key}', this.value)">
        `;
    }
    
    return `
      <div class="form-control">
        <label class="label">
          <span class="label-text">${param.label || key}</span>
          ${param.required ? '<span class="label-text-alt text-error">*</span>' : ''}
        </label>
        ${inputHtml}
        ${param.description ? `
          <label class="label">
            <span class="label-text-alt">${param.description}</span>
          </label>
        ` : ''}
      </div>
    `;
  }

  updateParameter(key, value) {
    this.parameters[key] = value;
  }

  updateSkipIfExists(skip) {
    this.config = { ...this.config, skipIfExists: skip };
  }

  updateContinueOnError(continueOn) {
    this.config = { ...this.config, continueOnError: continueOn };
  }

  updateShowProgress(show) {
    this.config = { ...this.config, showProgress: show };
  }

  configureInputs() {
    // Show input configuration modal
    const modal = document.getElementById('component-config-modal');
    const content = document.getElementById('component-config-content');
    
    content.innerHTML = `
      <div class="space-y-4">
        <h4 class="font-semibold">Configure Input Files</h4>
        <div class="form-control">
          <label class="label">
            <span class="label-text">Input File Pattern</span>
          </label>
          <input type="text" 
                 class="input input-bordered" 
                 placeholder="e.g., *.fastq, *.fq"
                 value="${this.config?.inputPattern || ''}"
                 onchange="this.updateInputPattern(this.value)">
        </div>
        <div class="form-control">
          <label class="label">
            <span class="label-text">Required Inputs</span>
          </label>
          <div class="space-y-2">
            ${this.toolConfig?.requiredInputs?.map(input => `
              <div class="flex items-center gap-2">
                <input type="checkbox" 
                       class="checkbox checkbox-sm" 
                       ${this.config?.requiredInputs?.includes(input) ? 'checked' : ''}
                       onchange="this.updateRequiredInput('${input}', this.checked)">
                <span class="text-sm">${input}</span>
              </div>
            `).join('') || 'No required inputs defined'}
          </div>
        </div>
      </div>
    `;
    
    modal.showModal();
  }

  configureOutputs() {
    // Show output configuration modal
    const modal = document.getElementById('component-config-modal');
    const content = document.getElementById('component-config-content');
    
    content.innerHTML = `
      <div class="space-y-4">
        <h4 class="font-semibold">Configure Output Files</h4>
        <div class="form-control">
          <label class="label">
            <span class="label-text">Output File Pattern</span>
          </label>
          <input type="text" 
                 class="input input-bordered" 
                 placeholder="e.g., *_processed.fastq"
                 value="${this.config?.outputPattern || ''}"
                 onchange="this.updateOutputPattern(this.value)">
        </div>
        <div class="form-control">
          <label class="label">
            <span class="label-text">Output Files</span>
          </label>
          <div class="space-y-2">
            ${this.toolConfig?.outputs?.map(output => `
              <div class="flex items-center gap-2">
                <input type="checkbox" 
                       class="checkbox checkbox-sm" 
                       ${this.config?.outputs?.includes(output) ? 'checked' : ''}
                       onchange="this.updateOutput('${output}', this.checked)">
                <span class="text-sm">${output}</span>
              </div>
            `).join('') || 'No outputs defined'}
          </div>
        </div>
      </div>
    `;
    
    modal.showModal();
  }

  updateInputPattern(pattern) {
    this.config = { ...this.config, inputPattern: pattern };
  }

  updateRequiredInput(input, required) {
    const requiredInputs = this.config?.requiredInputs || [];
    if (required) {
      requiredInputs.push(input);
    } else {
      const index = requiredInputs.indexOf(input);
      if (index > -1) {
        requiredInputs.splice(index, 1);
      }
    }
    this.config = { ...this.config, requiredInputs };
  }

  updateOutputPattern(pattern) {
    this.config = { ...this.config, outputPattern: pattern };
  }

  updateOutput(output, enabled) {
    const outputs = this.config?.outputs || [];
    if (enabled) {
      outputs.push(output);
    } else {
      const index = outputs.indexOf(output);
      if (index > -1) {
        outputs.splice(index, 1);
      }
    }
    this.config = { ...this.config, outputs };
  }

  selectFile(parameterKey) {
    // Show file browser for file parameters
    const modal = document.getElementById('file-browser-modal');
    const content = document.getElementById('file-browser-content');
    
    fetch('/api/server-files')
      .then(response => response.json())
      .then(files => {
        content.innerHTML = this.createFileBrowserContent(files);
        modal.showModal();
        
        window.selectFile = () => {
          const selectedFile = content.querySelector('input[type="radio"]:checked');
          if (selectedFile) {
            this.updateParameter(parameterKey, selectedFile.dataset.path);
            const input = this.element.querySelector(`#param_${this.toolName}_${parameterKey}`);
            if (input) {
              input.value = selectedFile.dataset.path;
            }
          }
          modal.close();
        };
      })
      .catch(error => {
        console.error('Error loading files:', error);
        alert('Error loading files');
      });
  }

  createFileBrowserContent(files) {
    return `
      <div class="space-y-2 max-h-96 overflow-y-auto">
        ${files.map(file => `
          <div class="flex items-center gap-2 p-2 hover:bg-base-200 rounded">
            <input type="radio" name="file" class="radio radio-sm" data-path="${file.path}" value="${file.name}">
            <i class="ti ${file.isDirectory ? 'ti-folder' : 'ti-file'} mr-2"></i>
            <span class="text-sm">${file.name}</span>
            ${file.size ? `<span class="text-xs opacity-70">(${this.formatFileSize(file.size)})</span>` : ''}
          </div>
        `).join('')}
      </div>
    `;
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getValue() {
    return {
      toolName: this.toolName,
      parameters: this.parameters,
      config: this.config
    };
  }

  setValue(value) {
    if (value.parameters) {
      this.parameters = value.parameters;
      this.loadParameters();
    }
    if (value.config) {
      this.config = value.config;
    }
  }

  validate() {
    const errors = [];
    
    // Check required parameters
    if (this.toolConfig?.parameters) {
      Object.entries(this.toolConfig.parameters).forEach(([key, param]) => {
        if (param.required && (!this.parameters[key] || this.parameters[key] === '')) {
          errors.push(`Parameter '${param.label || key}' is required`);
        }
      });
    }
    
    // Check required inputs
    if (this.config?.requiredInputs) {
      this.config.requiredInputs.forEach(input => {
        if (!this.parameters[input]) {
          errors.push(`Required input '${input}' is not connected`);
        }
      });
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  generateCommand(inputFiles, outputPath) {
    let command = this.toolName;
    
    // Add parameters
    Object.entries(this.parameters).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        const param = this.toolConfig?.parameters?.[key];
        if (param) {
          if (param.type === 'boolean' && value) {
            command += ` ${param.flag || `--${key}`}`;
          } else if (param.type !== 'boolean') {
            command += ` ${param.flag || `--${key}`} ${value}`;
          }
        }
      }
    });
    
    // Add input files
    if (inputFiles && inputFiles.length > 0) {
      command += ` ${inputFiles.join(' ')}`;
    }
    
    // Add output path
    if (outputPath) {
      command += ` -o ${outputPath}`;
    }
    
    return command;
  }
}

// Export for use in workflow builder
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ToolComponent;
} else {
  window.ToolComponent = ToolComponent;
} 