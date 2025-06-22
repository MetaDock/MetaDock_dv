// File Output Component
class FileOutput {
  constructor(type = 'local') {
    this.type = type; // 'local' or 'server'
    this.outputPath = '';
    this.element = null;
  }

  create() {
    const container = document.createElement('div');
    container.className = 'file-output-component';
    
    container.innerHTML = `
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <h3 class="card-title text-lg mb-3">
            <i class="ti ${this.type === 'local' ? 'ti-folder-down' : 'ti-folder-up'} mr-2"></i>
            ${this.type === 'local' ? 'Local Folder Output' : 'Server Folder Output'}
          </h3>
          
          <div class="space-y-3">
            <!-- Output Path -->
            <div class="form-control">
              <label class="label">
                <span class="label-text">Output Path</span>
              </label>
              <div class="join w-full">
                <input 
                  type="text" 
                  class="join-item input input-bordered flex-grow" 
                  placeholder="${this.type === 'local' ? '/path/to/output' : '/server/path/to/output'}"
                  value="${this.outputPath}"
                  onchange="this.updateOutputPath(this.value)"
                >
                <button class="join-item btn btn-outline" onclick="this.selectOutputPath()">
                  <i class="ti ti-folder-open"></i>
                </button>
              </div>
            </div>
            
            <!-- File Naming Pattern -->
            <div class="form-control">
              <label class="label">
                <span class="label-text">File Naming Pattern</span>
              </label>
              <input 
                type="text" 
                class="input input-bordered input-sm" 
                placeholder="e.g., {input_name}_processed.{extension}"
                value="${this.config?.namingPattern || ''}"
                onchange="this.updateNamingPattern(this.value)"
              >
              <label class="label">
                <span class="label-text-alt">Use {input_name}, {extension}, {timestamp} as placeholders</span>
              </label>
            </div>
            
            <!-- Output Options -->
            <div class="space-y-2">
              <div class="form-control">
                <label class="label cursor-pointer">
                  <span class="label-text">Create Subdirectories</span>
                  <input type="checkbox" class="checkbox checkbox-sm" ${this.config?.createSubdirs ? 'checked' : ''}>
                </label>
              </div>
              
              <div class="form-control">
                <label class="label cursor-pointer">
                  <span class="label-text">Overwrite Existing Files</span>
                  <input type="checkbox" class="checkbox checkbox-sm" ${this.config?.overwrite ? 'checked' : ''}>
                </label>
              </div>
              
              <div class="form-control">
                <label class="label cursor-pointer">
                  <span class="label-text">Preserve Original Structure</span>
                  <input type="checkbox" class="checkbox checkbox-sm" ${this.config?.preserveStructure ? 'checked' : ''}>
                </label>
              </div>
            </div>
            
            <!-- File Format Options -->
            <div class="form-control">
              <label class="label">
                <span class="label-text">Output Format</span>
              </label>
              <select class="select select-bordered select-sm" onchange="this.updateOutputFormat(this.value)">
                <option value="auto" ${this.config?.outputFormat === 'auto' ? 'selected' : ''}>Auto-detect</option>
                <option value="fastq" ${this.config?.outputFormat === 'fastq' ? 'selected' : ''}>FASTQ</option>
                <option value="fasta" ${this.config?.outputFormat === 'fasta' ? 'selected' : ''}>FASTA</option>
                <option value="sam" ${this.config?.outputFormat === 'sam' ? 'selected' : ''}>SAM</option>
                <option value="bam" ${this.config?.outputFormat === 'bam' ? 'selected' : ''}>BAM</option>
                <option value="txt" ${this.config?.outputFormat === 'txt' ? 'selected' : ''}>Text</option>
                <option value="json" ${this.config?.outputFormat === 'json' ? 'selected' : ''}>JSON</option>
                <option value="csv" ${this.config?.outputFormat === 'csv' ? 'selected' : ''}>CSV</option>
              </select>
            </div>
            
            <!-- Compression -->
            <div class="form-control">
              <label class="label">
                <span class="label-text">Compression</span>
              </label>
              <select class="select select-bordered select-sm" onchange="this.updateCompression(this.value)">
                <option value="none" ${this.config?.compression === 'none' ? 'selected' : ''}>None</option>
                <option value="gzip" ${this.config?.compression === 'gzip' ? 'selected' : ''}>Gzip (.gz)</option>
                <option value="bzip2" ${this.config?.compression === 'bzip2' ? 'selected' : ''}>Bzip2 (.bz2)</option>
                <option value="lz4" ${this.config?.compression === 'lz4' ? 'selected' : ''}>LZ4 (.lz4)</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    `;
    
    this.element = container;
    this.bindEvents();
    return container;
  }

  bindEvents() {
    const pathInput = this.element.querySelector('input[type="text"]');
    const browseBtn = this.element.querySelector('button');
    const namingPattern = this.element.querySelector('input[placeholder*="naming"]');
    const createSubdirs = this.element.querySelectorAll('input[type="checkbox"]')[0];
    const overwrite = this.element.querySelectorAll('input[type="checkbox"]')[1];
    const preserveStructure = this.element.querySelectorAll('input[type="checkbox"]')[2];
    const outputFormat = this.element.querySelector('select');
    const compression = this.element.querySelectorAll('select')[1];
    
    pathInput.onchange = (e) => this.updateOutputPath(e.target.value);
    browseBtn.onclick = () => this.selectOutputPath();
    namingPattern.onchange = (e) => this.updateNamingPattern(e.target.value);
    createSubdirs.onchange = (e) => this.updateCreateSubdirs(e.target.checked);
    overwrite.onchange = (e) => this.updateOverwrite(e.target.checked);
    preserveStructure.onchange = (e) => this.updatePreserveStructure(e.target.checked);
    outputFormat.onchange = (e) => this.updateOutputFormat(e.target.value);
    compression.onchange = (e) => this.updateCompression(e.target.value);
  }

  selectOutputPath() {
    if (this.type === 'local') {
      this.selectLocalPath();
    } else {
      this.selectServerPath();
    }
  }

  selectLocalPath() {
    // For local paths, we'll use a simple input dialog
    // In a real implementation, you might want to use a native file dialog
    const path = prompt('Enter local output path:', this.outputPath);
    if (path !== null) {
      this.updateOutputPath(path);
    }
  }

  async selectServerPath() {
    // Show folder browser modal
    const modal = document.getElementById('file-browser-modal');
    const content = document.getElementById('file-browser-content');
    
    try {
      const response = await fetch('/api/server-folders');
      const folders = await response.json();
      
      content.innerHTML = this.createFolderBrowserContent(folders);
      modal.showModal();
      
      // Set up folder selection
      window.selectFile = () => {
        const selectedFolder = content.querySelector('input[type="radio"]:checked');
        if (selectedFolder) {
          this.updateOutputPath(selectedFolder.dataset.path);
        }
        modal.close();
      };
    } catch (error) {
      console.error('Error loading server folders:', error);
      alert('Error loading server folders');
    }
  }

  createFolderBrowserContent(folders) {
    return `
      <div class="space-y-2 max-h-96 overflow-y-auto">
        <div class="flex items-center gap-2 p-2 hover:bg-base-200 rounded">
          <input type="radio" name="folder" class="radio radio-sm" data-path="/" value="root">
          <i class="ti ti-folder mr-2"></i>
          <span class="text-sm">Root Directory (/)</span>
        </div>
        ${folders.map(folder => `
          <div class="flex items-center gap-2 p-2 hover:bg-base-200 rounded">
            <input type="radio" name="folder" class="radio radio-sm" data-path="${folder.path}" value="${folder.name}">
            <i class="ti ti-folder mr-2"></i>
            <span class="text-sm">${folder.name}</span>
            <span class="text-xs opacity-70">(${folder.itemCount} items)</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  updateOutputPath(path) {
    this.outputPath = path;
    const input = this.element.querySelector('input[type="text"]');
    if (input) {
      input.value = path;
    }
  }

  updateNamingPattern(pattern) {
    this.config = { ...this.config, namingPattern: pattern };
  }

  updateCreateSubdirs(create) {
    this.config = { ...this.config, createSubdirs: create };
  }

  updateOverwrite(overwrite) {
    this.config = { ...this.config, overwrite: overwrite };
  }

  updatePreserveStructure(preserve) {
    this.config = { ...this.config, preserveStructure: preserve };
  }

  updateOutputFormat(format) {
    this.config = { ...this.config, outputFormat: format };
  }

  updateCompression(compression) {
    this.config = { ...this.config, compression: compression };
  }

  getValue() {
    return {
      outputPath: this.outputPath,
      config: this.config
    };
  }

  setValue(value) {
    if (value.outputPath) {
      this.outputPath = value.outputPath;
      this.updateOutputPath(value.outputPath);
    }
    if (value.config) {
      this.config = value.config;
      // Update UI elements
      const namingPattern = this.element.querySelector('input[placeholder*="naming"]');
      const createSubdirs = this.element.querySelectorAll('input[type="checkbox"]')[0];
      const overwrite = this.element.querySelectorAll('input[type="checkbox"]')[1];
      const preserveStructure = this.element.querySelectorAll('input[type="checkbox"]')[2];
      const outputFormat = this.element.querySelector('select');
      const compression = this.element.querySelectorAll('select')[1];
      
      if (namingPattern) namingPattern.value = this.config.namingPattern || '';
      if (createSubdirs) createSubdirs.checked = this.config.createSubdirs || false;
      if (overwrite) overwrite.checked = this.config.overwrite || false;
      if (preserveStructure) preserveStructure.checked = this.config.preserveStructure || false;
      if (outputFormat) outputFormat.value = this.config.outputFormat || 'auto';
      if (compression) compression.value = this.config.compression || 'none';
    }
  }

  validate() {
    if (!this.outputPath.trim()) {
      return { valid: false, message: 'Output path is required' };
    }
    
    // Validate naming pattern
    if (this.config?.namingPattern) {
      const pattern = this.config.namingPattern;
      const validPlaceholders = ['{input_name}', '{extension}', '{timestamp}'];
      const placeholderRegex = /\{([^}]+)\}/g;
      const matches = pattern.match(placeholderRegex);
      
      if (matches) {
        for (const match of matches) {
          if (!validPlaceholders.includes(match)) {
            return { valid: false, message: `Invalid placeholder: ${match}` };
          }
        }
      }
    }
    
    return { valid: true };
  }

  generateOutputPath(inputFile) {
    let outputPath = this.outputPath;
    
    if (this.config?.namingPattern) {
      let pattern = this.config.namingPattern;
      
      // Replace placeholders
      pattern = pattern.replace(/{input_name}/g, inputFile.name || inputFile.path.split('/').pop().split('.')[0]);
      pattern = pattern.replace(/{extension}/g, inputFile.path.split('.').pop() || 'txt');
      pattern = pattern.replace(/{timestamp}/g, new Date().toISOString().replace(/[:.]/g, '-'));
      
      outputPath = outputPath + '/' + pattern;
    }
    
    return outputPath;
  }
}

// Export for use in workflow builder
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileOutput;
} else {
  window.FileOutput = FileOutput;
} 