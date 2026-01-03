// Global variables
let selectedFiles = new Set();
let pollInterval = null;
let systemStatsInterval = null;

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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadFiles();
    loadPresets();
    loadHistory();
    startPolling();
    startSystemStatsPolling();
    
    // Handle preset upload
    presetUpload.addEventListener('change', handlePresetUpload);
    
    // Add keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Update status indicator
    updateStatusIndicator('idle');
});

// Load media files
async function loadFiles() {
    try {
        const loadingMessage = document.getElementById('loadingMessage');
        if (loadingMessage) {
            loadingMessage.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading files...';
        }
        
        const response = await fetch('/files');
        const files = await response.json();
        
        filesList.innerHTML = '';
        
        if (files.length === 0) {
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
        
        files.forEach(file => {
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
                <div class="file-size-cell">${file.size}</div>
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
        
        updateCounts(files.length, selectedFiles.size);
        updateSelectAllCheckbox();
        
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
    updateCounts(0, selectedFiles.size);
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
        const history = await response.json();
        
        historyTableBody.innerHTML = '';
        
        if (history.length === 0) {
            return;
        }
        
        history.reverse().forEach(job => {
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
                <td>${timeStr}</td>
            `;
            
            historyTableBody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading history:', error);
    }
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
        const promises = files.map(filename => 
            fetch('/queue/add', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ file: filename, preset, format })
            })
        );
        
        const results = await Promise.allSettled(promises);
        
        let successCount = 0;
        let errorCount = 0;
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.ok) {
                successCount++;
            } else {
                errorCount++;
                console.error(`Failed to add ${files[index]}:`, result.reason);
            }
        });
        
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
            
            const reduction = data.current.input_size && data.current.output_size 
                ? `${((data.current.input_size - data.current.output_size) / data.current.input_size * 100).toFixed(1)}%`
                : '-';
            
            currentJobContent.innerHTML = `
                <div class="job-info">
                    <div class="job-info-label">File</div>
                    <div class="job-info-value">${data.current.filename}</div>
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
                    <div class="job-info-value">${data.current.output_size || '0'} MB</div>
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
            currentJobContent.innerHTML = `<p class="no-job">No active encoding job</p>`;
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
        
        // Add current job to table
        if (data.current) {
            const reduction = data.current.input_size && data.current.output_size 
                ? `${((data.current.input_size - data.current.output_size) / data.current.input_size * 100).toFixed(1)}%`
                : '-';
            
            const row = document.createElement('tr');
            row.className = 'encoding';
            row.innerHTML = `
                <td>${data.current.filename}</td>
                <td>${data.current.preset}</td>
                <td>${data.current.format.toUpperCase()}</td>
                <td>${data.current.input_size || '-'} MB</td>
                <td>
                    <div class="progress-track">
                        <div class="progress-lavender" style="width: ${data.current.progress}%"></div>
                    </div>
                </td>
                <td><span class="status-badge status-encoding">Encoding</span></td>
                <td></td>
            `;
            queueTableBody.appendChild(row);
        }
        
        // Add queued jobs
        data.queue.forEach((job, index) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${job.filename}</td>
                <td>${job.preset}</td>
                <td>${job.format.toUpperCase()}</td>
                <td>-</td>
                <td>
                    <div class="progress-track">
                        <div class="progress-lavender" style="width: ${job.progress}%"></div>
                    </div>
                </td>
                <td><span class="status-badge status-queued">Queued</span></td>
                <td>
                    <div class="action-buttons">
                        <button onclick="moveInQueue('${job.id}', 'up')" class="btn btn-sm btn-secondary" ${index === 0 ? 'disabled' : ''}>
                            <i class="fas fa-arrow-up"></i>
                        </button>
                        <button onclick="moveInQueue('${job.id}', 'down')" class="btn btn-sm btn-secondary" ${index === data.queue.length - 1 ? 'disabled' : ''}>
                            <i class="fas fa-arrow-down"></i>
                        </button>
                        <button onclick="removeFromQueue('${job.id}')" class="btn btn-sm btn-danger">
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
        await fetch('/queue/remove', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: parseInt(jobId) })
        });
        updateQueueDisplay();
        showNotification('Removed from queue', 'success');
    } catch (error) {
        console.error('Error removing from queue:', error);
        showNotification('Failed to remove from queue', 'error');
    }
}

async function clearQueue() {
    if (!confirm('Are you sure you want to clear the entire queue?')) return;
    
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
    systemStatsInterval = setInterval(updateSystemStats, 3000);
}

async function updateSystemStats() {
    try {
        const response = await fetch('/system-stats');
        const stats = await response.json();
        
        document.getElementById('cpuValue').textContent = `${stats.cpu.toFixed(1)}%`;
        document.getElementById('ramValue').textContent = `${stats.ram.toFixed(1)}%`;
        document.getElementById('diskValue').textContent = `${stats.disk.toFixed(1)}%`;
        document.getElementById('netValue').textContent = `${stats.network.sent} ↑ / ${stats.network.recv} ↓`;
        document.getElementById('processValue').textContent = `${stats.process_cpu.toFixed(1)}% / ${stats.process_ram}`;
        document.getElementById('timeValue').textContent = stats.timestamp;
        
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

// Polling
function startPolling() {
    updateQueueDisplay();
    pollInterval = setInterval(updateQueueDisplay, 2000);
}

// Refresh files
function refreshFiles() {
    const filesList = document.getElementById('filesList');
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
    });
}

// Clean up intervals
window.addEventListener('beforeunload', () => {
    if (pollInterval) clearInterval(pollInterval);
    if (systemStatsInterval) clearInterval(systemStatsInterval);
});