import os
import signal
import subprocess
import threading
import re
import json
import psutil
from flask import Flask, jsonify, request, render_template
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from datetime import datetime
import time
from collections import deque
import math

# Load environment variables
load_dotenv("config.env")

# Directories from environment
MEDIA_DIR = os.getenv("MEDIA_DIR", "./media")
PRESET_DIR = os.getenv("PRESET_DIR", "./presets")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./output")

app = Flask(__name__)

# Global variables
encoding_queue = []
current_job = None
current_process = None
progress_percent = 0
status_message = "Idle"
encoding_history = []
encoding_details = {
    'current_fps': 0.0,
    'average_fps': 0.0,
    'bitrate': 0,
    'eta': '--:--',
    'time_elapsed': '00:00',
    'time_remaining': '00:00',
    'encoding_log': [],
    'frames_processed': 0,
    'total_frames': 0,
    'start_timestamp': None,
    'fps_history': deque(maxlen=60),
    'bitrate_history': deque(maxlen=60)
}

class EncodingJob:
    def __init__(self, file_id, filename, preset, output_format):
        self.id = file_id
        self.filename = filename
        self.preset = preset
        self.output_format = output_format
        self.status = "queued"
        self.progress = 0
        self.input_size = 0
        self.output_size = 0
        self.start_time = None
        self.end_time = None
        self.error = None
        self.current_fps = 0.0
        self.average_fps = 0.0
        self.bitrate = 0
        self.time_elapsed = '00:00'
        self.time_remaining = '--:--'
        self.eta = '--:--'

def get_file_size(path):
    """Get file size in MB"""
    if os.path.exists(path):
        return round(os.path.getsize(path) / (1024 * 1024), 2)
    return 0

def format_time(seconds):
    """Convert seconds to MM:SS or HH:MM:SS format"""
    if seconds < 0:
        return "--:--"
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    seconds = int(seconds % 60)
    
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"

def run_encode(job):
    global current_process, progress_percent, status_message, current_job, encoding_details
    
    input_path = os.path.join(MEDIA_DIR, job.filename)
    output_filename = os.path.splitext(job.filename)[0] + f".{job.output_format}"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    preset_path = os.path.join(PRESET_DIR, job.preset)
    
    # Get input file size
    job.input_size = get_file_size(input_path)
    
    # Reset encoding details
    encoding_details.update({
        'current_fps': 0.0,
        'average_fps': 0.0,
        'bitrate': 0,
        'eta': '--:--',
        'time_elapsed': '00:00',
        'time_remaining': '00:00',
        'encoding_log': [],
        'frames_processed': 0,
        'total_frames': 0,
        'start_timestamp': datetime.now(),
        'fps_history': deque(maxlen=60),
        'bitrate_history': deque(maxlen=60)
    })
    
    cmd = [
        "HandBrakeCLI",
        "-i", input_path,
        "-o", output_path,
        "--preset-import-file", preset_path,
        "--verbose"
    ]
    
    current_job = job
    job.status = "encoding"
    job.start_time = datetime.now().isoformat()
    progress_percent = 0
    status_message = f"Encoding: {job.filename}"
    
    try:
        current_process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        for line in current_process.stdout:
            # Add to log (limit to last 100 lines)
            encoding_details['encoding_log'].append({
                'timestamp': datetime.now().isoformat(),
                'message': line.strip(),
                'type': 'info'
            })
            if len(encoding_details['encoding_log']) > 100:
                encoding_details['encoding_log'] = encoding_details['encoding_log'][-100:]
            
            # Extract FPS
            fps_match = re.search(r'(\d+\.\d+|\d+)\s*fps', line.lower())
            if fps_match:
                current_fps = float(fps_match.group(1))
                encoding_details['current_fps'] = current_fps
                job.current_fps = current_fps
                
                # Update FPS history
                encoding_details['fps_history'].append({
                    'timestamp': datetime.now(),
                    'fps': current_fps
                })
                
                # Calculate average FPS
                if encoding_details['fps_history']:
                    avg_fps = sum(item['fps'] for item in encoding_details['fps_history']) / len(encoding_details['fps_history'])
                    encoding_details['average_fps'] = round(avg_fps, 1)
                    job.average_fps = round(avg_fps, 1)
            
            # Extract bitrate
            bitrate_match = re.search(r'(\d+\.\d+|\d+)\s*kbps', line.lower())
            if bitrate_match:
                bitrate = int(float(bitrate_match.group(1)))
                encoding_details['bitrate'] = bitrate
                job.bitrate = bitrate
            
            # Extract frame information
            frame_match = re.search(r'frame\s+(\d+)\s+of\s+(\d+)', line.lower())
            if frame_match:
                current_frame = int(frame_match.group(1))
                total_frames = int(frame_match.group(2))
                encoding_details['frames_processed'] = current_frame
                encoding_details['total_frames'] = total_frames
                
                # Calculate progress percentage
                if total_frames > 0:
                    progress_percent = (current_frame / total_frames) * 100
                    job.progress = progress_percent
                    
                    # Calculate ETA if we have FPS
                    if encoding_details['current_fps'] > 0:
                        frames_remaining = total_frames - current_frame
                        seconds_remaining = frames_remaining / encoding_details['current_fps']
                        
                        encoding_details['eta'] = format_time(seconds_remaining)
                        encoding_details['time_remaining'] = format_time(seconds_remaining)
                        job.eta = format_time(seconds_remaining)
                        job.time_remaining = format_time(seconds_remaining)
                        
                        # Calculate time elapsed
                        time_elapsed = (datetime.now() - encoding_details['start_timestamp']).total_seconds()
                        encoding_details['time_elapsed'] = format_time(time_elapsed)
                        job.time_elapsed = format_time(time_elapsed)
            
            # Alternative progress detection (for HandBrake versions without frame info)
            if "%" in line and "Encoding" in line:
                percent_match = re.search(r'(\d+\.\d+|\d+)\s*%', line)
                if percent_match:
                    progress_percent = float(percent_match.group(1))
                    job.progress = progress_percent
            
            status_message = f"Encoding {job.filename}: {progress_percent:.1f}%"
            
            # Sleep a bit to prevent high CPU usage
            time.sleep(0.01)
        
        # Wait for process to complete
        current_process.wait()
        
        if current_process.returncode == 0:
            job.status = "completed"
            job.output_size = get_file_size(output_path)
            job.progress = 100
            progress_percent = 100
            
            # Add completion message
            encoding_details['encoding_log'].append({
                'timestamp': datetime.now().isoformat(),
                'message': f"✓ Encoding completed successfully. Output saved to {output_filename}",
                'type': 'success'
            })
            
            # Calculate total time
            total_time = (datetime.now() - encoding_details['start_timestamp']).total_seconds()
            
            encoding_history.append({
                'filename': job.filename,
                'preset': job.preset,
                'format': job.output_format,
                'input_size': job.input_size,
                'output_size': job.output_size,
                'average_fps': job.average_fps,
                'bitrate': job.bitrate,
                'start_time': job.start_time,
                'end_time': datetime.now().isoformat(),
                'duration': job.time_elapsed,
                'reduction': f"{((job.input_size - job.output_size) / job.input_size * 100):.1f}%" if job.input_size > 0 else "0%"
            })
            
            status_message = f"Completed: {job.filename}"
            
        else:
            job.status = "failed"
            job.error = f"Process exited with code {current_process.returncode}"
            
            encoding_details['encoding_log'].append({
                'timestamp': datetime.now().isoformat(),
                'message': f"✗ Encoding failed with return code {current_process.returncode}",
                'type': 'error'
            })
            
            status_message = f"Failed: {job.filename}"
            
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        
        encoding_details['encoding_log'].append({
            'timestamp': datetime.now().isoformat(),
            'message': f"✗ Encoding error: {str(e)}",
            'type': 'error'
        })
        
        status_message = f"Error: {job.filename} - {str(e)}"
        print(f"Encoding error: {e}")
    
    finally:
        job.end_time = datetime.now().isoformat()
        current_process = None
        current_job = None
        
        # Start next job in queue (only if no job is running)
        process_queue()

def process_queue():
    """Process next job in queue if no job is currently running"""
    global encoding_queue, current_job
    
    if not current_job and encoding_queue:
        # Get the next job with status 'queued'
        for i, job in enumerate(encoding_queue):
            if job.status == "queued":
                next_job = encoding_queue.pop(i)
                thread = threading.Thread(target=run_encode, args=(next_job,))
                thread.daemon = True
                thread.start()
                break

@app.route("/")
def index():
    return render_template("index.html")

@app.get("/files")
def list_files():
    try:
        files = []
        for f in os.listdir(MEDIA_DIR):
            filepath = os.path.join(MEDIA_DIR, f)
            if os.path.isfile(filepath):
                size = get_file_size(filepath)
                modified = os.path.getmtime(filepath)
                extension = os.path.splitext(f)[1].lower().lstrip('.')
                
                files.append({
                    'name': f,
                    'size': size,
                    'size_display': f"{size} MB",
                    'modified': modified,
                    'type': extension if extension else 'unknown'
                })
        return jsonify(files)
    except Exception as e:
        print(f"Error listing files: {e}")
        return jsonify([])

@app.get("/presets")
def list_presets():
    try:
        files = [f for f in os.listdir(PRESET_DIR) if f.endswith(".json")]
        return jsonify(files)
    except:
        return jsonify([])

@app.get("/queue")
def get_queue():
    queue_data = []
    for job in encoding_queue:
        queue_data.append({
            'id': job.id,
            'filename': job.filename,
            'preset': job.preset,
            'format': job.output_format,
            'status': job.status,
            'progress': job.progress,
            'input_size': job.input_size,
            'output_size': job.output_size,
            'current_fps': job.current_fps,
            'average_fps': job.average_fps,
            'bitrate': job.bitrate,
            'time_elapsed': job.time_elapsed,
            'time_remaining': job.time_remaining,
            'eta': job.eta
        })
    
    current = None
    if current_job:
        current = {
            'id': current_job.id,
            'filename': current_job.filename,
            'preset': current_job.preset,
            'format': current_job.output_format,
            'status': current_job.status,
            'progress': current_job.progress,
            'input_size': current_job.input_size,
            'output_size': current_job.output_size,
            'current_fps': current_job.current_fps,
            'average_fps': current_job.average_fps,
            'bitrate': current_job.bitrate,
            'time_elapsed': current_job.time_elapsed,
            'time_remaining': current_job.time_remaining,
            'eta': current_job.eta
        }
    
    return jsonify({
        'queue': queue_data,
        'current': current,
        'status': status_message,
        'progress': progress_percent
    })

@app.get("/encoding-details")
def get_encoding_details():
    global encoding_details, current_job
    
    # Calculate size reduction if we have current job
    size_reduction = "-"
    if current_job and current_job.input_size and current_job.output_size:
        reduction = ((current_job.input_size - current_job.output_size) / current_job.input_size * 100)
        size_reduction = f"{reduction:.1f}%"
    elif current_job and current_job.input_size:
        size_reduction = "0%"
    
    return jsonify({
        'current_fps': encoding_details['current_fps'],
        'average_fps': encoding_details['average_fps'],
        'bitrate': encoding_details['bitrate'],
        'eta': encoding_details['eta'],
        'time_elapsed': encoding_details['time_elapsed'],
        'time_remaining': encoding_details['time_remaining'],
        'encoding_log': encoding_details['encoding_log'][-20:],  # Last 20 entries
        'frames_processed': encoding_details['frames_processed'],
        'total_frames': encoding_details['total_frames'],
        'input_file': current_job.filename if current_job else "-",
        'input_size': f"{current_job.input_size} MB" if current_job and current_job.input_size else "-",
        'output_size': f"{current_job.output_size} MB" if current_job and current_job.output_size else "-",
        'size_reduction': size_reduction,
        'preset': current_job.preset if current_job else "-",
        'format': current_job.output_format if current_job else "-"
    })

@app.get("/history")
def get_history():
    return jsonify(encoding_history[-20:])  # Last 20 jobs

@app.post("/queue/add")
def add_to_queue():
    data = request.json
    if not data or "file" not in data or "preset" not in data:
        return jsonify({"error": "Missing file or preset"}), 400
    
    # Check if file already in queue
    for job in encoding_queue:
        if job.filename == data["file"] and job.status != "completed" and job.status != "failed":
            return jsonify({"error": "File already in queue"}), 400
    
    job_id = int(time.time() * 1000)
    job = EncodingJob(
        job_id,
        data["file"],
        data["preset"],
        data.get("format", "mp4")
    )
    
    encoding_queue.append(job)
    
    # Start processing if nothing is running
    if not current_job:
        process_queue()
    
    return jsonify({"status": "added", "id": job_id})

@app.post("/queue/remove")
def remove_from_queue():
    data = request.json
    job_id = data.get("id")
    
    global encoding_queue
    
    # Find the job
    for i, job in enumerate(encoding_queue):
        if job.id == job_id:
            # Can't remove currently encoding job
            if job.status == "encoding":
                return jsonify({"error": "Cannot remove currently encoding job"}), 400
            
            encoding_queue.pop(i)
            return jsonify({"status": "removed"})
    
    return jsonify({"error": "Job not found"}), 404

@app.post("/queue/clear")
def clear_queue():
    global encoding_queue
    
    # Filter out only queued jobs (can't clear encoding jobs)
    encoding_queue = [job for job in encoding_queue if job.status == "encoding"]
    
    return jsonify({"status": "cleared"})

@app.post("/queue/move")
def move_in_queue():
    data = request.json
    job_id = data.get("id")
    direction = data.get("direction")
    
    # Only move queued jobs
    queued_jobs = [job for job in encoding_queue if job.status == "queued"]
    
    for i, job in enumerate(queued_jobs):
        if job.id == job_id:
            if direction == "up" and i > 0:
                # Swap positions in the original queue
                idx1 = encoding_queue.index(queued_jobs[i])
                idx2 = encoding_queue.index(queued_jobs[i-1])
                encoding_queue[idx1], encoding_queue[idx2] = encoding_queue[idx2], encoding_queue[idx1]
            elif direction == "down" and i < len(queued_jobs) - 1:
                idx1 = encoding_queue.index(queued_jobs[i])
                idx2 = encoding_queue.index(queued_jobs[i+1])
                encoding_queue[idx1], encoding_queue[idx2] = encoding_queue[idx2], encoding_queue[idx1]
            break
    
    return jsonify({"status": "moved"})

@app.post("/cancel")
def cancel_job():
    global current_process, current_job, status_message
    
    if current_process:
        try:
            current_process.terminate()
            current_process.wait(timeout=5)
        except:
            current_process.kill()
        current_process = None
    
    if current_job:
        current_job.status = "cancelled"
        current_job.end_time = datetime.now().isoformat()
        
        # Add cancellation message
        encoding_details['encoding_log'].append({
            'timestamp': datetime.now().isoformat(),
            'message': "⏹ Encoding cancelled by user",
            'type': 'warning'
        })
        
        current_job = None
    
    status_message = "Cancelled"
    
    # Start next job in queue
    process_queue()
    
    return jsonify({"status": "cancelled"})

@app.post("/upload-preset")
def upload_preset():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    
    file = request.files["file"]
    if not file.filename.endswith('.json'):
        return jsonify({"error": "Only .json files allowed"}), 400
    
    filename = secure_filename(file.filename)
    os.makedirs(PRESET_DIR, exist_ok=True)
    file.save(os.path.join(PRESET_DIR, filename))
    
    return jsonify({"status": "saved", "filename": filename})

@app.get("/system-stats")
def get_system_stats():
    cpu = psutil.cpu_percent(interval=0.2)
    ram = psutil.virtual_memory().percent
    disk = psutil.disk_usage('/').percent
    
    # Network stats
    net_io = psutil.net_io_counters()
    network = {
        'sent': f"{net_io.bytes_sent / (1024*1024):.1f} MB",
        'recv': f"{net_io.bytes_recv / (1024*1024):.1f} MB",
        'sent_mb': net_io.bytes_sent / (1024*1024),
        'recv_mb': net_io.bytes_recv / (1024*1024)
    }
    
    # Process stats if encoding
    process_cpu = 0
    process_ram = 0
    if current_process:
        try:
            p = psutil.Process(current_process.pid)
            process_cpu = p.cpu_percent(interval=0.1)
            process_ram = p.memory_info().rss / (1024 * 1024)  # MB
        except:
            pass
    
    return jsonify({
        'cpu': cpu,
        'ram': ram,
        'disk': disk,
        'network': network,
        'process_cpu': process_cpu,
        'process_ram': f"{process_ram:.1f} MB",
        'process_ram_mb': process_ram,
        'timestamp': datetime.now().strftime("%H:%M:%S")
    })

if __name__ == "__main__":
    # Create directories if they don't exist
    os.makedirs(MEDIA_DIR, exist_ok=True)
    os.makedirs(PRESET_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    app.run(host="0.0.0.0", port=5000, debug=False)