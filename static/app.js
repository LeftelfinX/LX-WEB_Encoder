// Global variables
let selectedFiles = new Set();
let pollInterval = null;
let systemStatsInterval = null;
let encodingDetailsInterval = null;
let historyInterval = null;
let filesData = [];
let queueData = [];
let historyData = [];
let currentSort = { field: 'name-asc', direction: 'asc' };
let queueSort = { field: 'filename', direction: 'asc' };
let historySort = { field: 'date', direction: 'desc' };
let expandedFolders = new Set();

// DOM Elements
const filesList = document.getElementById('filesList');
const presetSelect = document.getElementById('presetSelect');
const formatSelect = document.getElementById('formatSelect');
const presetUpload = document.getElementById('presetUpload');
const presetUploadStatus = document.getElementById('presetUploadStatus');
const queueTableBody = document.getElementById('queueTableBody');
const currentJobContent = document.getElementById('currentJobContent');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const cancelBtn = document.getElementById('cancelBtn');
const historyTableBody = document.getElementById('historyTableBody');
const statusText = document.getElementById('statusText');
const globalProgressFill = document.getElementById('globalProgressFill');
const globalProgressText = document.getElementById('globalProgressText');
const statusIndicator = document.querySelector('.status-indicator');
const encodingStatus = document.getElementById('encodingStatus');

// Mobile elements
const mobileStatusButton = document.getElementById('mobileStatusButton');
const mobileStatusPanel = document.getElementById('mobileStatusPanel');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadFiles();
    loadPresets();
    loadHistory();
    startPolling();
    startSystemStatsPolling();
    startEncodingDetailsPolling();
    startHistoryPolling();
    
    // Handle preset upload
    presetUpload.addEventListener('change', handlePresetUpload);
    
    // Setup keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Initialize sort dropdown
    const sortSelect = document.getElementById('sortSelect');
    sortSelect.value = currentSort.field;
    
    // Setup mobile
    setupMobile();
});

// File handling functions
async function loadFiles() {
    try {
        const loadingMessage = document.getElementById('loadingMessage');
        if (loadingMessage) {
            loadingMessage.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading files...';
        }
        
        const response = await fetch('/files');
        filesData = await response.json();
        
        // Sort files
        sortFilesData();
        
        updateFilesList();
        
    } catch (error) {
        console.error('Error loading files:', error);
        filesList.innerHTML = `
            <div class="list-empty">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Error loading files</p>
                <p class="help-text">${error.message}</p>
            </div>
        `;
        showNotification('Failed to load files', 'error');
    }
}

function updateFilesList() {
    if (filesData.length === 0) {
        filesList.innerHTML = `
            <div class="list-empty">
                <i class="fas fa-folder-open"></i>
                <p>No media files found</p>
                <p class="help-text">Place video files in the <code>media/</code> folder</p>
            </div>
        `;
        updateCounts(0, 0);
        return;
    }
    
    filesList.innerHTML = '';
    
    // Flatten the hierarchical data for display
    const flattenedFiles = flattenFiles(filesData, true);
    
    flattenedFiles.forEach(item => {
        const extension = item.type === 'directory' ? 'folder' : getFileExtension(item.name);
        const fileType = getFileType(extension);
        const typeClass = `file-type-${extension.toLowerCase()}`;
        const modifiedDate = item.modified ? formatDate(item.modified) : 'N/A';
        const indent = item.level * 20;
        const isExpanded = expandedFolders.has(item.path);
        const isHidden = item.parentPath && !expandedFolders.has(item.parentPath);
        
        const fileRow = document.createElement('div');
        fileRow.className = `file-row ${item.type === 'directory' ? 'directory' : ''} ${isHidden ? 'hidden' : ''}`;
        fileRow.dataset.filename = item.name;
        fileRow.dataset.path = item.path;
        fileRow.dataset.type = item.type;
        fileRow.dataset.parent = item.parentPath || '';
        fileRow.tabIndex = 0;
        
        // Only show checkbox for files
        const checkboxHtml = item.type === 'file' 
            ? `<input type="checkbox" class="file-checkbox" 
                      ${selectedFiles.has(item.path) ? 'checked' : ''}
                      onchange="toggleFileSelection('${item.path}', this.checked, '${item.name}')">`
            : '<div class="file-checkbox-placeholder"></div>';
        
        // Folder toggle button
        const folderToggle = item.type === 'directory' 
            ? `<div class="folder-toggle ${isExpanded ? 'expanded' : ''}" onclick="toggleFolder('${item.path}', event)">
                   <i class="fas fa-chevron-right"></i>
               </div>`
            : '<div class="folder-toggle-placeholder"></div>';
        
        fileRow.innerHTML = `
            <div class="file-checkbox-cell">
                ${checkboxHtml}
            </div>
            <div class="file-info-cell">
                <div class="file-indent" style="margin-left: ${indent}px">
                    ${folderToggle}
                    <i class="fas ${getFileIcon(extension)} ${typeClass} file-icon"></i>
                    <div class="file-details">
                        <div class="file-name" title="${item.name}">${item.name}</div>
                        ${item.type === 'file' ? `<span class="file-extension">${extension.toUpperCase()}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="file-size-cell">${item.size_display}</div>
            <div class="file-type-cell">${fileType}</div>
            <div class="file-date-cell">${modifiedDate}</div>
            <div class="file-actions-cell">
                ${item.type === 'file' ? 
                    `<button class="preview-btn" onclick="showFilePreview('${item.name}', '${item.path}')">
                        <i class="fas fa-eye"></i>
                    </button>` : ''
                }
            </div>
        `;
        
        // Click anywhere on row to select (only for files)
        if (item.type === 'file') {
            fileRow.addEventListener('click', (e) => {
                if (!e.target.classList.contains('file-checkbox') && 
                    !e.target.classList.contains('preview-btn') &&
                    !e.target.closest('.preview-btn') &&
                    !e.target.closest('.folder-toggle')) {
                    const checkbox = fileRow.querySelector('.file-checkbox');
                    checkbox.checked = !checkbox.checked;
                    toggleFileSelection(item.path, checkbox.checked, item.name);
                }
            });
            
            // Keyboard navigation
            fileRow.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const checkbox = fileRow.querySelector('.file-checkbox');
                    checkbox.checked = !checkbox.checked;
                    toggleFileSelection(item.path, checkbox.checked, item.name);
                }
            });
        }
        
        filesList.appendChild(fileRow);
    });
    
    const fileCount = flattenedFiles.filter(f => f.type === 'file').length;
    updateCounts(fileCount, selectedFiles.size);
    updateSelectAllCheckbox();
    updateSortIndicators();
}

// Helper functions
function flattenFiles(items, includeHidden = false, parentPath = '', result = []) {
    items.forEach(item => {
        const flattenedItem = {
            ...item,
            parentPath: parentPath
        };
        result.push(flattenedItem);
        
        if (item.children && item.children.length > 0) {
            if (includeHidden || expandedFolders.has(item.path)) {
                flattenFiles(item.children, includeHidden, item.path, result);
            }
        }
    });
    return result;
}

function toggleFolder(path, event) {
    event.stopPropagation();
    
    if (expandedFolders.has(path)) {
        expandedFolders.delete(path);
    } else {
        expandedFolders.add(path);
    }
    
    updateFilesList();
}

function getFileExtension(filename) {
    return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2) || 'unknown';
}

function getFileType(extension) {
    const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'];
    const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'];
    
    if (extension === 'folder') return 'Folder';
    if (videoExtensions.includes(extension.toLowerCase())) return 'Video';
    if (audioExtensions.includes(extension.toLowerCase())) return 'Audio';
    return 'File';
}

function getFileIcon(extension) {
    if (extension === 'folder') return 'fa-folder';
    const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'];
    const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'];
    
    if (videoExtensions.includes(extension.toLowerCase())) return 'fa-file-video';
    if (audioExtensions.includes(extension.toLowerCase())) return 'fa-file-audio';
    return 'fa-file';
}

function formatDate(timestamp) {
    try {
        const date = new Date(timestamp * 1000);
        return date.toLocaleDateString([], { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric'
        });
    } catch (e) {
        return 'N/A';
    }
}

// Sorting functions
function sortFilesData() {
    // Flatten files for sorting
    const flattened = flattenFiles(filesData, true);
    const [field, direction] = currentSort.field.split('-');
    const dir = direction === 'desc' ? -1 : 1;
    
    flattened.sort((a, b) => {
        let valA, valB;
        
        switch(field) {
            case 'name':
                valA = a.name.toLowerCase();
                valB = b.name.toLowerCase();
                break;
            case 'size':
                valA = a.size;
                valB = b.size;
                break;
            case 'date':
                valA = a.modified;
                valB = b.modified;
                break;
            case 'type':
                valA = a.type;
                valB = b.type;
                break;
            default:
                return 0;
        }
        
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });
    
    // Rebuild hierarchical structure
    const sortedStructure = rebuildHierarchy(flattened);
    filesData = sortedStructure;
}

function rebuildHierarchy(sortedItems) {
    const result = [];
    const map = new Map();
    
    // Create a map of all items
    sortedItems.forEach(item => {
        map.set(item.path, { ...item, children: [] });
    });
    
    // Build hierarchy
    sortedItems.forEach(item => {
        const parentPath = item.parentPath;
        if (parentPath && map.has(parentPath)) {
            map.get(parentPath).children.push(map.get(item.path));
        } else {
            result.push(map.get(item.path));
        }
    });
    
    return result;
}

function toggleSort(field) {
    const select = document.getElementById('sortSelect');
    if (currentSort.field === `${field}-asc`) {
        currentSort.field = `${field}-desc`;
    } else if (currentSort.field === `${field}-desc`) {
        currentSort.field = `${field}-asc`;
    } else {
        currentSort.field = `${field}-asc`;
    }
    
    select.value = currentSort.field;
    sortFilesData();
    updateFilesList();
}

function sortFiles() {
    const select = document.getElementById('sortSelect');
    currentSort.field = select.value;
    sortFilesData();
    updateFilesList();
}

function updateSortIndicators() {
    document.querySelectorAll('.sort-indicator').forEach(indicator => {
        indicator.className = 'sort-indicator';
    });
    
    const [field, direction] = currentSort.field.split('-');
    const indicator = document.getElementById(`sort-${field}`);
    if (indicator) {
        indicator.className = `sort-indicator active ${direction}`;
    }
}

// Queue sorting
function toggleQueueSort(field) {
    if (queueSort.field === field) {
        queueSort.direction = queueSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        queueSort.field = field;
        queueSort.direction = 'asc';
    }
    
    sortQueueData();
    updateQueueDisplay();
}

function sortQueueData() {
    if (!queueData) return;
    
    queueData.sort((a, b) => {
        let valA, valB;
        
        switch(queueSort.field) {
            case 'filename':
                valA = a.filename.toLowerCase();
                valB = b.filename.toLowerCase();
                break;
            case 'preset':
                valA = a.preset.toLowerCase();
                valB = b.preset.toLowerCase();
                break;
            case 'format':
                valA = a.format.toLowerCase();
                valB = b.format.toLowerCase();
                break;
            case 'input':
                valA = a.input_size || 0;
                valB = b.input_size || 0;
                break;
            case 'status':
                valA = a.status.toLowerCase();
                valB = b.status.toLowerCase();
                break;
            default:
                return 0;
        }
        
        const dir = queueSort.direction === 'asc' ? 1 : -1;
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });
}

// History sorting
function toggleHistorySort(field) {
    if (historySort.field === field) {
        historySort.direction = historySort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        historySort.field = field;
        historySort.direction = 'asc';
    }
    
    sortHistoryData();
    updateHistoryDisplay();
}

function sortHistory() {
    const select = document.getElementById('historySortSelect');
    const [field, direction] = select.value.split('-');
    historySort.field = field;
    historySort.direction = direction;
    sortHistoryData();
    updateHistoryDisplay();
}

function sortHistoryData() {
    if (!historyData) return;
    
    historyData.sort((a, b) => {
        let valA, valB;
        
        switch(historySort.field) {
            case 'filename':
                valA = a.filename.toLowerCase();
                valB = b.filename.toLowerCase();
                break;
            case 'preset':
                valA = a.preset.toLowerCase();
                valB = b.preset.toLowerCase();
                break;
            case 'input':
                valA = a.input_size || 0;
                valB = b.input_size || 0;
                break;
            case 'output':
                valA = a.output_size || 0;
                valB = b.output_size || 0;
                break;
            case 'reduction':
                valA = parseFloat(a.reduction) || 0;
                valB = parseFloat(b.reduction) || 0;
                break;
            case 'fps':
                valA = a.average_fps || 0;
                valB = b.average_fps || 0;
                break;
            case 'date':
                valA = new Date(a.start_time).getTime();
                valB = new Date(b.start_time).getTime();
                break;
            default:
                return 0;
        }
        
        const dir = historySort.direction === 'asc' ? 1 : -1;
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });
}

// Selection functions
function updateCounts(total, selected) {
    document.getElementById('totalCount').textContent = `${total} file${total !== 1 ? 's' : ''} total`;
    document.getElementById('selectedCount').textContent = selected === 0 
        ? 'No files selected' 
        : `${selected} file${selected !== 1 ? 's' : ''} selected`;
}

function toggleFileSelection(filepath, isSelected, filename) {
    if (isSelected) {
        selectedFiles.add(filepath);
    } else {
        selectedFiles.delete(filepath);
    }
    
    const row = document.querySelector(`.file-row[data-path="${filepath}"]`);
    if (row) {
        const checkbox = row.querySelector('.file-checkbox');
        if (checkbox) {
            checkbox.checked = isSelected;
            row.classList.toggle('selected', isSelected);
        }
    }
    
    updateSelectAllCheckbox();
    const fileCount = flattenFiles(filesData, true).filter(f => f.type === 'file').length;
    updateCounts(fileCount, selectedFiles.size);
}

function selectAllFiles() {
    const checkboxes = document.querySelectorAll('.file-checkbox');
    checkboxes.forEach(checkbox => {
        if (!checkbox.checked) {
            const row = checkbox.closest('.file-row');
            const filepath = row.dataset.path;
            const filename = row.dataset.filename;
            checkbox.checked = true;
            toggleFileSelection(filepath, true, filename);
        }
    });
}

function deselectAllFiles() {
    const checkboxes = document.querySelectorAll('.file-checkbox');
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            const row = checkbox.closest('.file-row');
            const filepath = row.dataset.path;
            const filename = row.dataset.filename;
            checkbox.checked = false;
            toggleFileSelection(filepath, false, filename);
        }
    });
}

function toggleSelectAll(isSelected) {
    if (isSelected) {
        selectAllFiles();
    } else {
        deselectAllFiles();
    }
}

function updateSelectAllCheckbox() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    if (!selectAllCheckbox) return;
    
    const totalCheckboxes = document.querySelectorAll('.file-checkbox').length;
    const checkedCheckboxes = document.querySelectorAll('.file-checkbox:checked').length;
    
    if (totalCheckboxes === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedCheckboxes === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedCheckboxes === totalCheckboxes) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

// Load presets
async function loadPresets() {
    try {
        const response = await fetch('/presets');
        const presets = await response.json();
        
        presetSelect.innerHTML = '<option value="">Select a preset...</option>';
        presets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset;
            option.textContent = preset;
            presetSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading presets:', error);
        showNotification('Failed to load presets', 'error');
    }
}

// Load history
async function loadHistory() {
    try {
        const response = await fetch('/history');
        historyData = await response.json();
        
        sortHistoryData();
        updateHistoryDisplay();
        
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

// Start history polling
function startHistoryPolling() {
    loadHistory();
    historyInterval = setInterval(loadHistory, 3000); // Reload every 3 seconds
}

function updateHistoryDisplay() {
    historyTableBody.innerHTML = '';
    
    if (historyData.length === 0) {
        historyTableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-history">
                    <i class="fas fa-clock"></i>
                    <p>No encoding history yet</p>
                </td>
            </tr>
        `;
        return;
    }
    
    historyData.forEach(job => {
        const row = document.createElement('tr');
        const startTime = new Date(job.start_time);
        const timeStr = startTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const reduction = job.reduction || '0%';
        
        row.innerHTML = `
            <td>${job.filename}</td>
            <td>${job.preset}</td>
            <td>${job.input_size} MB</td>
            <td>${job.output_size} MB</td>
            <td><span class="status-badge ${reduction.includes('-') ? 'status-error' : 'status-success'}">${reduction}</span></td>
            <td>${job.average_fps?.toFixed(1) || '0.0'} FPS</td>
            <td>${timeStr}</td>
        `;
        
        historyTableBody.appendChild(row);
    });
}

// Add to queue
async function addToQueue() {
    const preset = presetSelect.value;
    const format = formatSelect.value;
    
    if (!preset) {
        showNotification('Please select a preset', 'error');
        return;
    }
    
    if (selectedFiles.size === 0) {
        showNotification('Please select at least one file', 'error');
        return;
    }
    
    try {
        const files = Array.from(selectedFiles);
        let successCount = 0;
        let errorCount = 0;
        
        for (const filepath of files) {
            try {
                const response = await fetch('/queue/add', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ 
                        file: filepath.split('/').pop(), 
                        path: filepath,
                        preset, 
                        format 
                    })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    successCount++;
                } else {
                    errorCount++;
                    console.error(`Failed to add ${filepath}:`, data.error);
                }
            } catch (error) {
                errorCount++;
                console.error(`Error adding ${filepath}:`, error);
            }
        }
        
        if (successCount > 0) {
            showNotification(`Added ${successCount} file${successCount !== 1 ? 's' : ''} to queue`, 'success');
        }
        if (errorCount > 0) {
            showNotification(`Failed to add ${errorCount} file${errorCount !== 1 ? 's' : ''}`, 'error');
        }
        
        selectedFiles.clear();
        loadFiles();
        updateQueueDisplay();
        
    } catch (error) {
        console.error('Error adding to queue:', error);
        showNotification('Failed to add files to queue', 'error');
    }
}

// Update queue display
async function updateQueueDisplay() {
    try {
        const response = await fetch('/queue');
        const data = await response.json();
        
        queueData = data.queue;
        sortQueueData();
        
        // Update global status
        statusText.textContent = data.status || 'Ready';
        globalProgressFill.style.width = `${data.progress || 0}%`;
        globalProgressText.textContent = `${Math.round(data.progress || 0)}%`;
        
        // Update status indicator
        if (data.current) {
            if (data.paused) {
                updateStatusIndicator('paused');
            } else {
                updateStatusIndicator('encoding');
            }
        } else if (data.queue.length > 0) {
            updateStatusIndicator('queued');
        } else {
            updateStatusIndicator('idle');
        }
        
        // Update current job
        if (data.current) {
            document.getElementById('currentJobProgress').style.width = `${data.current.progress}%`;
            document.getElementById('currentJobPercent').textContent = `${Math.round(data.current.progress)}%`;
            
            const currentOutputSize = data.current.status === 'encoding' || data.current.status === 'paused'
                ? (data.current.current_output_size || data.current.output_size)
                : data.current.output_size;
            
            const reduction = data.current.input_size && currentOutputSize 
                ? `${((data.current.input_size - currentOutputSize) / data.current.input_size * 100).toFixed(1)}%`
                : '-';
            
            currentJobContent.innerHTML = `
                <div class="job-info">
                    <div class="job-info-label">File</div>
                    <div class="job-info-value" style="word-break: break-word;">${data.current.filename}</div>
                </div>
                <div class="job-info">
                    <div class="job-info-label">Preset</div>
                    <div class="job-info-value">${data.current.preset}</div>
                </div>
                <div class="job-info">
                    <div class="job-info-label">Format</div>
                    <div class="job-info-value">${data.current.format.toUpperCase()}</div>
                </div>
                <div class="job-info">
                    <div class="job-info-label">Input Size</div>
                    <div class="job-info-value">${data.current.input_size || '0'} MB</div>
                </div>
                <div class="job-info">
                    <div class="job-info-label">Output Size</div>
                    <div class="job-info-value">${currentOutputSize || '0'} MB</div>
                </div>
                <div class="job-info">
                    <div class="job-info-label">Reduction</div>
                    <div class="job-info-value">${reduction}</div>
                </div>
            `;
            
            // Update control buttons
            startBtn.disabled = true;
            pauseBtn.disabled = data.current.status !== 'encoding' || data.paused;
            resumeBtn.disabled = data.current.status !== 'paused' || !data.paused;
            cancelBtn.disabled = false;
            
        } else {
            document.getElementById('currentJobProgress').style.width = '0%';
            document.getElementById('currentJobPercent').textContent = '0%';
            currentJobContent.innerHTML = `<div class="no-job">No active encoding job</div>`;
            
            startBtn.disabled = data.queue.length === 0;
            pauseBtn.disabled = true;
            resumeBtn.disabled = true;
            cancelBtn.disabled = true;
        }
        
        // Update queue table
        queueTableBody.innerHTML = '';
        
        if (data.queue.length === 0 && !data.current) {
            queueTableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-queue">
                        <i class="fas fa-inbox"></i>
                        <p>Queue is empty. Add files to get started.</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        // Add queued jobs
        queueData.forEach((job, index) => {
            const row = document.createElement('tr');
            const statusClass = {
                'queued': 'status-queued',
                'encoding': 'status-encoding',
                'paused': 'status-paused',
                'completed': 'status-completed',
                'failed': 'status-failed',
                'cancelled': 'status-cancelled'
            }[job.status] || 'status-queued';
            
            const statusText = job.status.charAt(0).toUpperCase() + job.status.slice(1);
            
            row.className = job.status;
            
            const outputSizeDisplay = job.status === 'encoding' || job.status === 'paused'
                ? (job.current_output_size || job.output_size || '-')
                : (job.output_size || '-');
            
            row.innerHTML = `
                <td>${job.filename}</td>
                <td>${job.preset}</td>
                <td>${job.format.toUpperCase()}</td>
                <td>${job.input_size || '0'} MB</td>
                <td>
                    <div class="progress-track">
                        <div class="progress-lavender" style="width: ${job.progress}%"></div>
                    </div>
                </td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <div class="action-buttons">
                        <button onclick="moveInQueue('${job.id}', 'up')" class="btn btn-sm btn-secondary" ${index === 0 || job.status !== 'queued' ? 'disabled' : ''}>
                            <i class="fas fa-arrow-up"></i>
                        </button>
                        <button onclick="moveInQueue('${job.id}', 'down')" class="btn btn-sm btn-secondary" ${index === queueData.length - 1 || job.status !== 'queued' ? 'disabled' : ''}>
                            <i class="fas fa-arrow-down"></i>
                        </button>
                        <button onclick="removeFromQueue('${job.id}')" class="btn btn-sm btn-danger" ${job.status === 'encoding' || job.status === 'paused' ? 'disabled' : ''}>
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </td>
            `;
            queueTableBody.appendChild(row);
        });
        
    } catch (error) {
        console.error('Error updating queue:', error);
    }
}

// Queue management
async function moveInQueue(jobId, direction) {
    try {
        await fetch('/queue/move', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: parseInt(jobId), direction })
        });
        updateQueueDisplay();
        showNotification(`Job moved ${direction}`, 'info');
    } catch (error) {
        console.error('Error moving job:', error);
        showNotification('Failed to move job', 'error');
    }
}

async function removeFromQueue(jobId) {
    try {
        const response = await fetch('/queue/remove', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: parseInt(jobId) })
        });
        
        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to remove');
        }
        
        updateQueueDisplay();
        showNotification('Removed from queue', 'success');
    } catch (error) {
        console.error('Error removing from queue:', error);
        showNotification(error.message, 'error');
    }
}

async function clearQueue() {
    if (!confirm('Are you sure you want to clear all queued jobs? (Currently encoding job will continue)')) return;
    
    try {
        await fetch('/queue/clear', { method: 'POST' });
        updateQueueDisplay();
        showNotification('Queue cleared', 'success');
    } catch (error) {
        console.error('Error clearing queue:', error);
        showNotification('Failed to clear queue', 'error');
    }
}

// Start encoding
async function startEncoding() {
    try {
        const response = await fetch('/start', { method: 'POST' });
        const data = await response.json();
        
        if (response.ok) {
            showNotification('Encoding started', 'success');
            updateQueueDisplay();
        } else {
            showNotification(data.error || 'Failed to start encoding', 'error');
        }
    } catch (error) {
        console.error('Error starting encoding:', error);
        showNotification('Failed to start encoding', 'error');
    }
}

// Pause/Resume/Cancel
async function pauseJob() {
    try {
        await fetch('/pause', { method: 'POST' });
        updateQueueDisplay();
        showNotification('Encoding paused', 'warning');
    } catch (error) {
        console.error('Error pausing job:', error);
        showNotification('Failed to pause encoding', 'error');
    }
}

async function resumeJob() {
    try {
        await fetch('/resume', { method: 'POST' });
        updateQueueDisplay();
        showNotification('Encoding resumed', 'success');
    } catch (error) {
        console.error('Error resuming job:', error);
        showNotification('Failed to resume encoding', 'error');
    }
}

async function cancelJob() {
    if (!confirm('Are you sure you want to cancel the current encoding job?')) return;
    
    try {
        await fetch('/cancel', { method: 'POST' });
        updateQueueDisplay();
        showNotification('Encoding cancelled', 'warning');
    } catch (error) {
        console.error('Error cancelling job:', error);
        showNotification('Failed to cancel encoding', 'error');
    }
}

// Encoding details polling
function startEncodingDetailsPolling() {
    updateEncodingDetails();
    encodingDetailsInterval = setInterval(updateEncodingDetails, 1000);
}

async function updateEncodingDetails() {
    try {
        const response = await fetch('/encoding-details');
        const details = await response.json();
        
        // Update metrics with animation for FPS changes
        const currentFpsElement = document.getElementById('currentFps');
        const avgFpsElement = document.getElementById('avgFps');
        
        if (parseFloat(currentFpsElement.textContent) !== details.current_fps) {
            currentFpsElement.classList.remove('fps-high', 'fps-low');
            if (details.current_fps > 30) currentFpsElement.classList.add('fps-high');
            else if (details.current_fps > 0 && details.current_fps < 15) currentFpsElement.classList.add('fps-low');
        }
        
        if (parseFloat(avgFpsElement.textContent) !== details.average_fps) {
            avgFpsElement.classList.remove('fps-high', 'fps-low');
            if (details.average_fps > 30) avgFpsElement.classList.add('fps-high');
            else if (details.average_fps > 0 && details.average_fps < 15) avgFpsElement.classList.add('fps-low');
        }
        
        // Update values - Use ETA from HandBrake output
        currentFpsElement.textContent = details.current_fps.toFixed(1);
        avgFpsElement.textContent = details.average_fps.toFixed(1);
        
        // Use ETA from HandBrake output if available
        const etaValue = details.eta_from_output && details.eta_from_output !== '--:--' 
            ? details.eta_from_output 
            : details.eta;
        
        document.getElementById('eta').textContent = etaValue;
        document.getElementById('inputFile').textContent = details.input_file;
        document.getElementById('inputSize').textContent = details.input_size;
        document.getElementById('outputSize').textContent = details.output_size;
        document.getElementById('sizeReduction').textContent = details.size_reduction;
        document.getElementById('encodingPreset').textContent = details.preset;
        document.getElementById('encodingFormat').textContent = details.format;
        document.getElementById('timeElapsed').textContent = details.time_elapsed;
        document.getElementById('timeRemaining').textContent = etaValue;
        
        // Update encoding status
        encodingStatus.textContent = details.paused ? 'Paused' : 
                                   details.input_file !== '-' ? 'Encoding' : 'Idle';
        
        // Update encoding log
        const encodingLog = document.getElementById('encodingLog');
        if (details.encoding_log && details.encoding_log.length > 0) {
            encodingLog.innerHTML = '';
            details.encoding_log.forEach(log => {
                const logEntry = document.createElement('div');
                logEntry.className = `log-entry ${log.type}`;
                logEntry.textContent = log.message;
                encodingLog.appendChild(logEntry);
            });
            
            encodingLog.scrollTop = encodingLog.scrollHeight;
        }
        
    } catch (error) {
        console.error('Error updating encoding details:', error);
    }
}

function clearEncodingLog() {
    const encodingLog = document.getElementById('encodingLog');
    encodingLog.innerHTML = '<div class="log-entry">Log cleared</div>';
}

// File preview
function showFilePreview(filename, filepath) {
    const previewModal = document.getElementById('previewModal');
    const previewBody = document.getElementById('previewBody');
    
    const extension = getFileExtension(filename);
    const fileType = getFileType(extension);
    
    previewBody.innerHTML = `
        <div class="preview-info">
            <div class="preview-info-item">
                <div class="preview-label">Filename</div>
                <div class="preview-value">${filename}</div>
            </div>
            <div class="preview-info-item">
                <div class="preview-label">Type</div>
                <div class="preview-value">${fileType} (${extension.toUpperCase()})</div>
            </div>
            <div class="preview-info-item">
                <div class="preview-label">Location</div>
                <div class="preview-value">media/${filepath}</div>
            </div>
        </div>
        <div class="preview-actions">
            <button class="btn btn-lavender" onclick="addSingleFileToQueue('${filename}', '${filepath}')">
                <i class="fas fa-plus-circle"></i> Add to Queue
            </button>
            <button class="btn btn-secondary" onclick="closeFilePreview()">
                Close
            </button>
        </div>
    `;
    
    previewModal.style.display = 'flex';
    
    previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) closeFilePreview();
    });
    
    const closeOnEscape = (e) => {
        if (e.key === 'Escape') closeFilePreview();
    };
    document.addEventListener('keydown', closeOnEscape);
    previewModal.dataset.escapeHandler = closeOnEscape;
}

function closeFilePreview() {
    const previewModal = document.getElementById('previewModal');
    previewModal.style.display = 'none';
    const handler = previewModal.dataset.escapeHandler;
    if (handler) {
        document.removeEventListener('keydown', handler);
        delete previewModal.dataset.escapeHandler;
    }
}

async function addSingleFileToQueue(filename, filepath) {
    const preset = presetSelect.value;
    const format = formatSelect.value;
    
    if (!preset) {
        showNotification('Please select a preset first', 'error');
        closeFilePreview();
        return;
    }
    
    try {
        const response = await fetch('/queue/add', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                file: filename, 
                path: filepath,
                preset, 
                format 
            })
        });
        
        if (response.ok) {
            showNotification(`Added "${filename}" to queue`, 'success');
            closeFilePreview();
            updateQueueDisplay();
        } else {
            const data = await response.json();
            throw new Error(data.error || 'Failed to add to queue');
        }
    } catch (error) {
        console.error('Error adding file to queue:', error);
        showNotification(error.message, 'error');
    }
}

// Preset upload
async function handlePresetUpload() {
    const file = presetUpload.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        presetUploadStatus.textContent = 'Uploading...';
        presetUploadStatus.style.background = 'rgba(251, 191, 36, 0.2)';
        presetUploadStatus.style.color = '#fbbf24';
        
        const response = await fetch('/upload-preset', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (response.ok) {
            presetUploadStatus.textContent = `✓ ${data.filename}`;
            presetUploadStatus.style.background = 'rgba(74, 222, 128, 0.2)';
            presetUploadStatus.style.color = '#4ade80';
            showNotification('Preset uploaded successfully', 'success');
            loadPresets();
        } else {
            presetUploadStatus.textContent = data.error || 'Upload failed';
            presetUploadStatus.style.background = 'rgba(248, 113, 113, 0.2)';
            presetUploadStatus.style.color = '#f87171';
            showNotification('Upload failed', 'error');
        }
        
        setTimeout(() => {
            presetUploadStatus.textContent = '';
            presetUploadStatus.style.background = '';
            presetUploadStatus.style.color = '';
        }, 3000);
        
        presetUpload.value = '';
        
    } catch (error) {
        console.error('Error uploading preset:', error);
        presetUploadStatus.textContent = 'Upload failed';
        presetUploadStatus.style.background = 'rgba(248, 113, 113, 0.2)';
        presetUploadStatus.style.color = '#f87171';
        showNotification('Upload failed', 'error');
    }
}

// System stats
function startSystemStatsPolling() {
    updateSystemStats();
    systemStatsInterval = setInterval(updateSystemStats, 2000);
}

async function updateSystemStats() {
    try {
        const response = await fetch('/system-stats');
        const stats = await response.json();
        
        // Update mobile panel
        document.getElementById('mobileCpu').textContent = `${stats.cpu.toFixed(1)}%`;
        document.getElementById('mobileRam').textContent = `${stats.ram.toFixed(1)}%`;
        document.getElementById('mobileDisk').textContent = `${stats.disk.toFixed(1)}%`;
        document.getElementById('mobileProcess').textContent = `${stats.process_cpu.toFixed(1)}% ${stats.process_ram_mb.toFixed(1)}MB`;
        document.getElementById('mobileTime').textContent = stats.timestamp;
        
        // Update progress bars
        document.getElementById('mobileCpuBar').style.width = `${stats.cpu}%`;
        document.getElementById('mobileRamBar').style.width = `${stats.ram}%`;
        document.getElementById('mobileDiskBar').style.width = `${stats.disk}%`;
        
    } catch (error) {
        console.error('Error updating system stats:', error);
    }
}

// Status indicator
function updateStatusIndicator(status) {
    if (!statusIndicator) return;
    
    statusIndicator.className = 'status-indicator';
    switch(status) {
        case 'encoding':
            statusIndicator.classList.add('encoding');
            break;
        case 'paused':
            statusIndicator.classList.add('paused');
            break;
        case 'error':
            statusIndicator.classList.add('error');
            break;
        case 'queued':
            statusIndicator.classList.add('encoding');
            break;
        default:
            statusIndicator.classList.add('idle');
    }
}

// Mobile setup
function setupMobile() {
    // Detect mobile
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        mobileStatusButton.style.display = 'flex';
    }
}

function toggleMobileStatus() {
    mobileStatusPanel.style.display = mobileStatusPanel.style.display === 'block' ? 'none' : 'block';
}

function closeMobileStatus() {
    mobileStatusPanel.style.display = 'none';
}

// Click outside to close mobile panel
document.addEventListener('click', (e) => {
    if (!mobileStatusPanel.contains(e.target) && !mobileStatusButton.contains(e.target)) {
        mobileStatusPanel.style.display = 'none';
    }
});

// Polling
function startPolling() {
    updateQueueDisplay();
    pollInterval = setInterval(updateQueueDisplay, 2000);
}

// Refresh files
function refreshFiles() {
    filesList.innerHTML = `
        <div class="list-loading">
            <i class="fas fa-spinner fa-spin"></i> Refreshing files...
        </div>
    `;
    
    loadFiles();
    showNotification('Files list refreshed', 'info');
}

// Notifications
function showNotification(message, type) {
    const existing = document.querySelectorAll('.notification');
    existing.forEach(n => n.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    let bgColor, borderColor;
    switch (type) {
        case 'success':
            bgColor = 'rgba(74, 222, 128, 0.1)';
            borderColor = '#4ade80';
            break;
        case 'error':
            bgColor = 'rgba(248, 113, 113, 0.1)';
            borderColor = '#f87171';
            break;
        case 'warning':
            bgColor = 'rgba(251, 191, 36, 0.1)';
            borderColor = '#fbbf24';
            break;
        case 'info':
            bgColor = 'rgba(200, 182, 255, 0.1)';
            borderColor = '#c8b6ff';
            break;
        default:
            bgColor = 'rgba(128, 128, 128, 0.1)';
            borderColor = '#808080';
    }
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: var(--text-primary);
        background: ${bgColor};
        border: 1px solid ${borderColor};
        border-left: 4px solid ${borderColor};
        font-weight: 500;
        z-index: 10000;
        animation: slideIn 0.3s ease;
        max-width: 400px;
        box-shadow: var(--shadow-lg);
        backdrop-filter: blur(10px);
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, 5000);
}

// Add CSS for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Keyboard shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + A to select all files
        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
            e.preventDefault();
            selectAllFiles();
        }
        
        // Escape to close preview
        if (e.key === 'Escape') {
            closeFilePreview();
        }
        
        // Space to toggle selection on focused row
        if (e.key === ' ' && document.activeElement.closest('.file-row')) {
            e.preventDefault();
            const row = document.activeElement.closest('.file-row');
            const checkbox = row.querySelector('.file-checkbox');
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                const filepath = row.dataset.path;
                const filename = row.dataset.filename;
                toggleFileSelection(filepath, checkbox.checked, filename);
            }
        }
        
        // Ctrl/Cmd + Enter to add to queue
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            addToQueue();
        }
        
        // F5 to refresh files
        if (e.key === 'F5') {
            e.preventDefault();
            refreshFiles();
        }
    });
}

// Clean up intervals
window.addEventListener('beforeunload', () => {
    if (pollInterval) clearInterval(pollInterval);
    if (systemStatsInterval) clearInterval(systemStatsInterval);
    if (encodingDetailsInterval) clearInterval(encodingDetailsInterval);
    if (historyInterval) clearInterval(historyInterval);
});