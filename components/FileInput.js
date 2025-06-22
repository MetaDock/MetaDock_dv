// File Input Component
class FileInput {
  constructor(type = 'local') {
    this.type = type; // 'local' or 'server'
    this.selectedFiles = [];
    this.element = null;
  }

  create() {
    const container = document.createElement('div');
    container.className = 'file-input-component';
    
    container.innerHTML = `
      <div class="card bg-base-100 shadow-sm">
        <div class="card-body p-4">
          <h3 class="card-title text-lg mb-3">
            <i class="ti ${this.type === 'local' ? 'ti-upload' : 'ti-server'} mr-2"></i>
            ${this.type === 'local' ? 'Local File Input' : 'Server File Input'}
          </h3>
          
          <div class="space-y-3">
            <!-- File Selection -->
            <div class="form-control">
              <label class="label">
                <span class="label-text">Select Files</span>
              </label>
              <div class="flex gap-2">
                <button class="btn btn-outline btn-sm" onclick="this.selectFiles()">
                  <i class="ti ti-folder-open mr-1"></i>
                  Browse
                </button>
                <button class="btn btn-outline btn-sm" onclick="this.clearFiles()">
                  <i class="ti ti-trash mr-1"></i>
                  Clear
                </button>
              </div>
            </div>
            
            <!-- File List -->
            <div class="file-list max-h-32 overflow-y-auto">
              <div class="text-center text-base-content/50 text-sm">
                No files selected
              </div>
            </div>
            
            <!-- File Type Filter -->
            <div class="form-control">
              <label class="label">
                <span class="label-text">File Type Filter</span>
              </label>
              <input 
                type="text" 
                class="input input-bordered input-sm" 
                placeholder="e.g., *.fastq, *.fq, *.txt"
                onchange="this.updateFileFilter(this.value)"
              >
            </div>
            
            <!-- Options -->
            <div class="form-control">
              <label class="label cursor-pointer">
                <span class="label-text">Allow Multiple Files</span>
                <input type="checkbox" class="checkbox checkbox-sm" checked>
              </label>
            </div>
            
            <div class="form-control">
              <label class="label cursor-pointer">
                <span class="label-text">Required</span>
                <input type="checkbox" class="checkbox checkbox-sm" checked>
              </label>
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
    const browseBtn = this.element.querySelector('button');
    const clearBtn = this.element.querySelectorAll('button')[1];
    const fileFilter = this.element.querySelector('input[type="text"]');
    const multipleCheckbox = this.element.querySelectorAll('input[type="checkbox"]')[0];
    const requiredCheckbox = this.element.querySelectorAll('input[type="checkbox"]')[1];
    
    browseBtn.onclick = () => this.selectFiles();
    clearBtn.onclick = () => this.clearFiles();
    fileFilter.onchange = (e) => this.updateFileFilter(e.target.value);
    multipleCheckbox.onchange = (e) => this.updateMultipleFiles(e.target.checked);
    requiredCheckbox.onchange = (e) => this.updateRequired(e.target.checked);
  }

  selectFiles() {
    if (this.type === 'local') {
      this.selectLocalFiles();
    } else {
      this.selectServerFiles();
    }
  }

  selectLocalFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = this.config?.allowMultiple !== false;
    
    if (this.config?.fileFilter) {
      input.accept = this.config.fileFilter;
    }
    
    input.onchange = (e) => {
      const files = Array.from(e.target.files);
      this.addFiles(files);
    };
    
    input.click();
  }

  async selectServerFiles() {
    // Show file browser modal
    const modal = document.getElementById('file-browser-modal');
    const content = document.getElementById('file-browser-content');
    
    try {
      const response = await fetch('/api/server-files');
      const files = await response.json();
      
      content.innerHTML = this.createFileBrowserContent(files);
      modal.showModal();
      
      // Set up file selection
      window.selectFile = () => {
        const selectedFiles = Array.from(content.querySelectorAll('input[type="checkbox"]:checked'))
          .map(checkbox => checkbox.dataset.path);
        
        this.addServerFiles(selectedFiles);
        modal.close();
      };
    } catch (error) {
      console.error('Error loading server files:', error);
      alert('Error loading server files');
    }
  }

  createFileBrowserContent(files) {
    return `
      <div class="space-y-2 max-h-96 overflow-y-auto">
        ${files.map(file => `
          <div class="flex items-center gap-2 p-2 hover:bg-base-200 rounded">
            <input type="checkbox" class="checkbox checkbox-sm" data-path="${file.path}">
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

  addFiles(files) {
    this.selectedFiles = [...this.selectedFiles, ...files];
    this.updateFileList();
  }

  addServerFiles(filePaths) {
    const serverFiles = filePaths.map(path => ({
      name: path.split('/').pop(),
      path: path,
      isServer: true
    }));
    
    this.selectedFiles = [...this.selectedFiles, ...serverFiles];
    this.updateFileList();
  }

  clearFiles() {
    this.selectedFiles = [];
    this.updateFileList();
  }

  updateFileList() {
    const fileList = this.element.querySelector('.file-list');
    
    if (this.selectedFiles.length === 0) {
      fileList.innerHTML = `
        <div class="text-center text-base-content/50 text-sm">
          No files selected
        </div>
      `;
      return;
    }
    
    fileList.innerHTML = this.selectedFiles.map((file, index) => `
      <div class="flex items-center justify-between p-2 bg-base-200 rounded mb-1">
        <div class="flex items-center gap-2">
          <i class="ti ${file.isServer ? 'ti-server' : 'ti-file'} text-sm"></i>
          <span class="text-sm">${file.name || file.path}</span>
        </div>
        <button class="btn btn-xs btn-error" onclick="this.removeFile(${index})">
          <i class="ti ti-x"></i>
        </button>
      </div>
    `).join('');
  }

  removeFile(index) {
    this.selectedFiles.splice(index, 1);
    this.updateFileList();
  }

  updateFileFilter(filter) {
    this.config = { ...this.config, fileFilter: filter };
  }

  updateMultipleFiles(allow) {
    this.config = { ...this.config, allowMultiple: allow };
  }

  updateRequired(required) {
    this.config = { ...this.config, required: required };
  }

  getValue() {
    return {
      files: this.selectedFiles,
      config: this.config
    };
  }

  setValue(value) {
    if (value.files) {
      this.selectedFiles = value.files;
      this.updateFileList();
    }
    if (value.config) {
      this.config = value.config;
    }
  }

  validate() {
    if (this.config?.required && this.selectedFiles.length === 0) {
      return { valid: false, message: 'Files are required' };
    }
    return { valid: true };
  }
}

// Export for use in workflow builder
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileInput;
} else {
  window.FileInput = FileInput;
} 