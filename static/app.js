// Global variables
let selectedFiles = new Set();
let pollInterval = null;
let systemStatsInterval = null;
let encodingDetailsInterval = null;
let filesData = [];
let queueData = [];
let historyData = [];
let currentSort = { field: 'name-asc', direction: 'asc' };
let queueSort = { field: 'filename', direction: 'asc' };
let historySort = { field: 'date', direction: 'desc' };
let isFloatingBarCollapsed = false;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// DOM Elements
const filesList = document.getElementById('filesList');
const presetSelect = document.getElementById('presetSelect');
const formatSelect = document.getElementById('formatSelect');
const presetUpload = document.getElementById('presetUpload');
const presetUploadStatus = document.getElementById('presetUploadStatus');
const queueTableBody = document.getElementById('queueTableBody');
const currentJobContent = document.getElementById('currentJobContent');
const startBtn = document.getElementById('startBtn');
const cancelBtn = document.getElementById('cancelBtn');
const historyTableBody = document.getElementById('historyTableBody');
const statusText = document.getElementById('statusText');
const globalProgressFill = document.getElementById('globalProgressFill');
const globalProgressText = document.getElementById('globalProgressText');
const statusIndicator = document.querySelector('.status-indicator');
const floatingStatusBar = document.getElementById('floatingStatusBar');
const floatingToggleIcon = document.getElementById('floatingToggleIcon');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadFiles();
    loadPresets();
    loadHistory();
    startPolling();
    startSystemStatsPolling();
    startEncodingDetailsPolling();
    
    // Handle preset upload
    presetUpload.addEventListener('change', handlePresetUpload);
    
    // Setup floating bar dragging
    setupFloatingBarDrag();
    
    // Load saved floating bar position
    loadFloatingBarPosition();
    
    // Setup keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Initialize sort dropdown
    const sortSelect = document.getElementById('sortSelect');
    sortSelect.value = currentSort.field;
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
    
    filesData.forEach(file => {
        const extension = getFileExtension(file.name);
        const fileType = getFileType(extension);
        const typeClass = `file-type-${extension.toLowerCase()}`;
        const modifiedDate = file.modified ? formatDate(file.modified) : 'N/A';
        
        const fileRow = document.createElement('div');
        fileRow.className = `file-row ${selectedFiles.has(file.name) ? 'selected' : ''}`;
        fileRow.dataset.filename = file.name;
        fileRow.tabIndex = 0;
        
        fileRow.innerHTML = `
            <div class="file-checkbox-cell">
                <input type="checkbox" class="file-checkbox" 
                       ${selectedFiles.has(file.name) ? 'checked' : ''}
                       onchange="toggleFileSelection('${file.name}', this.checked)">
            </div>
            <div class="file-info-cell">
                <i class="fas ${getFileIcon(extension)} ${typeClass} file-icon"></i>
                <div class="file-details">
                    <div class="file-name" title="${file.name}">${file.name}</div>
                    <span class="file-extension">${extension.toUpperCase()}</span>
                </div>
            </div>
            <div class="file-size-cell">${file.size_display}</div>
            <div class="file-type-cell">${fileType}</div>
            <div class="file-date-cell">${modifiedDate}</div>
            <div class="file-actions-cell">
                <button class="preview-btn" onclick="showFilePreview('${file.name}')">
                    <i class="fas fa-eye"></i>
                </button>
            </div>
        `;
        
        // Click anywhere on row to select
        fileRow.addEventListener('click', (e) => {
            if (!e.target.classList.contains('file-checkbox') && 
                !e.target.classList.contains('preview-btn') &&
                !e.target.closest('.preview-btn')) {
                const checkbox = fileRow.querySelector('.file-checkbox');
                checkbox.checked = !checkbox.checked;
                toggleFileSelection(file.name, checkbox.checked);
            }
        });
        
        // Keyboard navigation
        fileRow.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const checkbox = fileRow.querySelector('.file-checkbox');
                checkbox.checked = !checkbox.checked;
                toggleFileSelection(file.name, checkbox.checked);
            }
        });
        
        filesList.appendChild(fileRow);
    });
    
    updateCounts(filesData.length, selectedFiles.size);
    updateSelectAllCheckbox();
    updateSortIndicators();
}

// Helper functions
function getFileExtension(filename) {
    return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2) || 'unknown';
}

function getFileType(extension) {
    const videoExtensions = ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v'];
    const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a'];
    
    if (videoExtensions.includes(extension.toLowerCase())) return 'Video';
    if (audioExtensions.includes(extension.toLowerCase())) return 'Audio';
    return 'File';
}

function getFileIcon(extension) {
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
    const [field, direction] = currentSort.field.split('-');
    const dir = direction === 'desc' ? -1 : 1;
    
    filesData.sort((a, b) => {
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
                valA = getFileExtension(a.name).toLowerCase();
                valB = getFileExtension(b.name).toLowerCase();
                break;
            default:
                return 0;
        }
        
        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });
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
    // Clear all indicators
    document.querySelectorAll('.sort-indicator').forEach(indicator => {
        indicator.className = 'sort-indicator';
    });
    
    // Set active indicator
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

function toggleFileSelection(filename, isSelected) {
    if (isSelected) {
        selectedFiles.add(filename);
    } else {
        selectedFiles.delete(filename);
    }
    
    const row = document.querySelector(`.file-row[data-filename="${filename}"]`);
    if (row) {
        row.classList.toggle('selected', isSelected);
        row.querySelector('.file-checkbox').checked = isSelected;
    }
    
    updateSelectAllCheckbox();
    updateCounts(filesData.length, selectedFiles.size);
}

function selectAllFiles() {
    const checkboxes = document.querySelectorAll('.file-checkbox');
    checkboxes.forEach(checkbox => {
        if (!checkbox.checked) {
            const filename = checkbox.closest('.file-row').dataset.filename;
            checkbox.checked = true;
            toggleFileSelection(filename, true);
        }
    });
}

function deselectAllFiles() {
    const checkboxes = document.querySelectorAll('.file-checkbox');
    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            const filename = checkbox.closest('.file-row').dataset.filename;
            checkbox.checked = false;
            toggleFileSelection(filename, false);
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
        
        for (const filename of files) {
            try {
                const response = await fetch('/queue/add', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ file: filename, preset, format })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    successCount++;
                } else {
                    errorCount++;
                    console.error(`Failed to add ${filename}:`, data.error);
                }
            } catch (error) {
                errorCount++;
                console.error(`Error adding ${filename}:`, error);
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
            updateStatusIndicator('encoding');
        } else if (data.queue.length > 0) {
            updateStatusIndicator('queued');
        } else {
            updateStatusIndicator('idle');
        }
        
        // Update current job
        if (data.current) {
            document.getElementById('currentJobProgress').style.width = `${data.current.progress}%`;
            document.getElementById('currentJobPercent').textContent = `${Math.round(data.current.progress)}%`;
            
            // Get current output size (use current_output_size if encoding, otherwise output_size)
            const currentOutputSize = data.current.status === 'encoding' 
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
            
            startBtn.disabled = true;
            cancelBtn.disabled = false;
            
        } else {
            document.getElementById('currentJobProgress').style.width = '0%';
            document.getElementById('currentJobPercent').textContent = '0%';
            currentJobContent.innerHTML = `<div class="no-job">No active encoding job</div>`;
            startBtn.disabled = data.queue.length === 0;
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
            row.className = job.status === 'encoding' ? 'encoding' : job.status === 'completed' ? 'completed' : job.status === 'failed' ? 'failed' : job.status === 'cancelled' ? 'cancelled' : '';
            
            const statusClass = {
                'queued': 'status-queued',
                'encoding': 'status-encoding',
                'completed': 'status-completed',
                'failed': 'status-failed',
                'cancelled': 'status-cancelled'
            }[job.status] || 'status-queued';
            
            const statusText = job.status.charAt(0).toUpperCase() + job.status.slice(1);
            
            // Show current output size for encoding jobs, final output size for completed
            const outputSizeDisplay = job.status === 'encoding' 
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
                        <button onclick="removeFromQueue('${job.id}')" class="btn btn-sm btn-danger" ${job.status === 'encoding' ? 'disabled' : ''}>
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

async function startQueue() {
    updateQueueDisplay();
    showNotification('Started encoding queue', 'success');
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
        
        // Animate FPS changes
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
        
        // Update values
        currentFpsElement.textContent = details.current_fps.toFixed(1);
        avgFpsElement.textContent = details.average_fps.toFixed(1);
        document.getElementById('bitrate').textContent = `${details.bitrate} kbps`;
        document.getElementById('eta').textContent = details.eta;
        document.getElementById('inputFile').textContent = details.input_file;
        document.getElementById('inputSize').textContent = details.input_size;
        document.getElementById('outputSize').textContent = details.output_size;
        document.getElementById('sizeReduction').textContent = details.size_reduction;
        document.getElementById('encodingPreset').textContent = details.preset;
        document.getElementById('encodingFormat').textContent = details.format;
        document.getElementById('timeElapsed').textContent = details.time_elapsed;
        document.getElementById('timeRemaining').textContent = details.time_remaining;
        
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
            
            // Auto-scroll to bottom
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
function showFilePreview(filename) {
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
                <div class="preview-value">media/${filename}</div>
            </div>
        </div>
        <div class="preview-actions">
            <button class="btn btn-lavender" onclick="addSingleFileToQueue('${filename}')">
                <i class="fas fa-plus-circle"></i> Add to Queue
            </button>
            <button class="btn btn-secondary" onclick="closeFilePreview()">
                Close
            </button>
        </div>
    `;
    
    previewModal.style.display = 'flex';
    
    // Close modal when clicking outside
    previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) closeFilePreview();
    });
    
    // Close with Escape
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

async function addSingleFileToQueue(filename) {
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
            body: JSON.stringify({ file: filename, preset, format })
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
        }, 5000);
        
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
        
        // Update floating bar
        document.getElementById('floatingCpu').textContent = `${stats.cpu.toFixed(1)}%`;
        document.getElementById('floatingRam').textContent = `${stats.ram.toFixed(1)}%`;
        document.getElementById('floatingDisk').textContent = `${stats.disk.toFixed(1)}%`;
        document.getElementById('floatingNet').textContent = `${stats.network.sent_mb.toFixed(1)}/${stats.network.recv_mb.toFixed(1)}`;
        document.getElementById('floatingProcess').textContent = `${stats.process_cpu.toFixed(1)}% ${stats.process_ram_mb.toFixed(1)}MB`;
        document.getElementById('floatingTime').textContent = stats.timestamp;
        
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

// Floating status bar
function toggleFloatingStatus() {
    isFloatingBarCollapsed = !isFloatingBarCollapsed;
    
    if (isFloatingBarCollapsed) {
        floatingStatusBar.classList.add('collapsed');
        floatingToggleIcon.className = 'fas fa-chevron-up';
    } else {
        floatingStatusBar.classList.remove('collapsed');
        floatingToggleIcon.className = 'fas fa-chevron-down';
    }
    
    // Save state
    localStorage.setItem('floatingBarCollapsed', isFloatingBarCollapsed);
}

function setupFloatingBarDrag() {
    floatingStatusBar.addEventListener('mousedown', startDrag);
    floatingStatusBar.addEventListener('touchstart', startDragTouch);
    
    function startDrag(e) {
        e.preventDefault();
        isDragging = true;
        dragOffset.x = e.clientX - floatingStatusBar.offsetLeft;
        dragOffset.y = e.clientY - floatingStatusBar.offsetTop;
        
        floatingStatusBar.classList.add('dragging');
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stopDrag);
    }
    
    function startDragTouch(e) {
        if (e.touches.length === 1) {
            e.preventDefault();
            isDragging = true;
            const touch = e.touches[0];
            dragOffset.x = touch.clientX - floatingStatusBar.offsetLeft;
            dragOffset.y = touch.clientY - floatingStatusBar.offsetTop;
            
            floatingStatusBar.classList.add('dragging');
            document.addEventListener('touchmove', dragTouch, { passive: false });
            document.addEventListener('touchend', stopDragTouch);
        }
    }
    
    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();
        
        let x = e.clientX - dragOffset.x;
        let y = e.clientY - dragOffset.y;
        
        // Constrain to window bounds
        const maxX = window.innerWidth - floatingStatusBar.offsetWidth;
        const maxY = window.innerHeight - floatingStatusBar.offsetHeight;
        
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(20, Math.min(y, maxY - 20)); // Keep some margin from bottom
        
        floatingStatusBar.style.left = `${x}px`;
        floatingStatusBar.style.top = `${y}px`;
        floatingStatusBar.style.transform = 'none';
        
        // Save position
        saveFloatingBarPosition(x, y);
    }
    
    function dragTouch(e) {
        if (!isDragging || e.touches.length !== 1) return;
        e.preventDefault();
        
        const touch = e.touches[0];
        let x = touch.clientX - dragOffset.x;
        let y = touch.clientY - dragOffset.y;
        
        // Constrain to window bounds
        const maxX = window.innerWidth - floatingStatusBar.offsetWidth;
        const maxY = window.innerHeight - floatingStatusBar.offsetHeight;
        
        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(20, Math.min(y, maxY - 20));
        
        floatingStatusBar.style.left = `${x}px`;
        floatingStatusBar.style.top = `${y}px`;
        floatingStatusBar.style.transform = 'none';
        
        // Save position
        saveFloatingBarPosition(x, y);
    }
    
    function stopDrag() {
        isDragging = false;
        floatingStatusBar.classList.remove('dragging');
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', stopDrag);
    }
    
    function stopDragTouch() {
        isDragging = false;
        floatingStatusBar.classList.remove('dragging');
        document.removeEventListener('touchmove', dragTouch);
        document.removeEventListener('touchend', stopDragTouch);
    }
}

function saveFloatingBarPosition(x, y) {
    localStorage.setItem('floatingBarPosition', JSON.stringify({ x, y }));
}

function loadFloatingBarPosition() {
    const saved = localStorage.getItem('floatingBarPosition');
    const collapsed = localStorage.getItem('floatingBarCollapsed') === 'true';
    
    if (saved) {
        const { x, y } = JSON.parse(saved);
        floatingStatusBar.style.left = `${x}px`;
        floatingStatusBar.style.top = `${y}px`;
        floatingStatusBar.style.transform = 'none';
    }
    
    if (collapsed) {
        isFloatingBarCollapsed = true;
        floatingStatusBar.classList.add('collapsed');
        floatingToggleIcon.className = 'fas fa-chevron-up';
    }
}

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
    // Remove existing notifications
    const existing = document.querySelectorAll('.notification');
    existing.forEach(n => n.remove());
    
    // Create notification
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // Style based on type
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
    
    // Remove after 5 seconds
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
                const filename = row.dataset.filename;
                toggleFileSelection(filename, checkbox.checked);
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
});

// Handle window resize
window.addEventListener('resize', () => {
    // Re-center floating bar if it's off screen
    const rect = floatingStatusBar.getBoundingClientRect();
    if (rect.right > window.innerWidth || rect.bottom > window.innerHeight || rect.left < 0 || rect.top < 0) {
        floatingStatusBar.style.left = '50%';
        floatingStatusBar.style.top = 'auto';
        floatingStatusBar.style.bottom = '20px';
        floatingStatusBar.style.transform = 'translateX(-50%)';
        saveFloatingBarPosition(floatingStatusBar.offsetLeft, floatingStatusBar.offsetTop);
    }
});