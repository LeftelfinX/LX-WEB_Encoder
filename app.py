import os
import signal
import subprocess
import threading
import re
import json
import psutil
import shutil
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
TEMP_DIR = os.getenv("TEMP_DIR", "./temp")

app = Flask(__name__)

# Global variables
encoding_queue = []
current_job = None
current_process = None
paused = False
stopped = False
progress_percent = 0
status_message = "Idle"
encoding_history = []
encoding_details = {
    'current_fps': 0.0,
    'average_fps': 0.0,
    'eta': '--:--',
    'time_elapsed': '00:00',
    'time_remaining': '00:00',
    'encoding_log': [],
    'frames_processed': 0,
    'total_frames': 0,
    'start_timestamp': None,
    'fps_history': deque(maxlen=60),
    'eta_from_output': '--:--',
}

class EncodingJob:
    def __init__(self, file_id, filename, preset, output_format, file_path=None):
        self.id = file_id
        self.filename = filename
        self.file_path = file_path  # Full path for files in subdirectories
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
        self.time_elapsed = '00:00'
        self.time_remaining = '--:--'
        self.eta = '--:--'
        self.current_output_size = 0  # Track current size during encoding
        self.temp_output_path = None

def get_file_size(path):
    """Get file size in MB"""
    if os.path.exists(path):
        return round(os.path.getsize(path) / (1024 * 1024), 2)
    return 0

def format_time(seconds):
    """Convert seconds to MM:SS or HH:MM:SS format"""
    if seconds is None or seconds < 0:
        return "--:--"
    
    try:
        seconds = int(seconds)
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        secs = seconds % 60
        
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        return f"{minutes:02d}:{secs:02d}"
    except (ValueError, TypeError):
        return "--:--"

def extract_eta_from_line(line):
    """Extract ETA from HandBrake output line"""
    # Pattern for ETA: "ETA 00h01m23s" or "ETA 01:23:45"
    patterns = [
        r'eta\s+(\d{1,2})h(\d{1,2})m(\d{1,2})s',  # ETA 01h23m45s
        r'eta\s+(\d{1,2}):(\d{1,2}):(\d{1,2})',   # ETA 01:23:45
        r'eta\s+(\d{1,2}):(\d{1,2})',             # ETA 01:23
    ]
    
    line_lower = line.lower()
    
    for pattern in patterns:
        match = re.search(pattern, line_lower)
        if match:
            groups = match.groups()
            if len(groups) == 3:
                # Format: hh:mm:ss or hh mm ss
                try:
                    hours = int(groups[0])
                    minutes = int(groups[1])
                    seconds = int(groups[2])
                    total_seconds = hours * 3600 + minutes * 60 + seconds
                    return format_time(total_seconds)
                except ValueError:
                    pass
            elif len(groups) == 2:
                # Format: mm:ss
                try:
                    minutes = int(groups[0])
                    seconds = int(groups[1])
                    total_seconds = minutes * 60 + seconds
                    return format_time(total_seconds)
                except ValueError:
                    pass
    
    return None

def run_encode(job):
    global current_process, progress_percent, status_message, current_job, encoding_details, paused, stopped
    
    input_path = job.file_path if job.file_path else os.path.join(MEDIA_DIR, job.filename)
    
    # Create temp filename
    temp_filename = f"temp_{job.id}_{job.filename}"
    output_filename = os.path.splitext(job.filename)[0] + f".{job.output_format}"
    
    # Create temp output path
    job.temp_output_path = os.path.join(TEMP_DIR, temp_filename)
    final_output_path = os.path.join(OUTPUT_DIR, output_filename)
    
    preset_path = os.path.join(PRESET_DIR, job.preset)
    
    # Get input file size
    job.input_size = get_file_size(input_path)
    
    # Reset encoding details
    encoding_details.update({
        'current_fps': 0.0,
        'average_fps': 0.0,
        'eta': '--:--',
        'eta_from_output': '--:--',
        'time_elapsed': '00:00',
        'time_remaining': '00:00',
        'encoding_log': [],
        'frames_processed': 0,
        'total_frames': 0,
        'start_timestamp': datetime.now(),
        'fps_history': deque(maxlen=60),
    })
    
    cmd = [
        "HandBrakeCLI",
        "-i", input_path,
        "-o", job.temp_output_path,
        "--preset-import-file", preset_path,
        "--verbose"
    ]
    
    current_job = job
    job.status = "encoding"
    job.start_time = datetime.now().isoformat()
    progress_percent = 0
    status_message = f"Encoding: {job.filename}"
    stopped = False
    
    # Clear temp file if exists
    if os.path.exists(job.temp_output_path):
        try:
            os.remove(job.temp_output_path)
        except:
            pass
    
    try:
        current_process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        # Start a thread to monitor output file size during encoding
        def monitor_output_size():
            while current_process and current_process.poll() is None and not stopped:
                try:
                    if os.path.exists(job.temp_output_path):
                        job.current_output_size = get_file_size(job.temp_output_path)
                    else:
                        job.current_output_size = 0
                except:
                    job.current_output_size = 0
                time.sleep(1)
        
        monitor_thread = threading.Thread(target=monitor_output_size)
        monitor_thread.daemon = True
        monitor_thread.start()
        
        for line in current_process.stdout:
            # Check if stopped
            if stopped:
                break
            
            # Check if paused
            while paused and current_process and current_process.poll() is None and not stopped:
                time.sleep(0.5)
            
            # Add to log (limit to last 100 lines)
            encoding_details['encoding_log'].append({
                'timestamp': datetime.now().isoformat(),
                'message': line.strip(),
                'type': 'info'
            })
            if len(encoding_details['encoding_log']) > 100:
                encoding_details['encoding_log'] = encoding_details['encoding_log'][-100:]
            
            # Extract ETA from HandBrake output
            eta_from_output = extract_eta_from_line(line)
            if eta_from_output:
                encoding_details['eta_from_output'] = eta_from_output
                job.eta = eta_from_output
                encoding_details['eta'] = eta_from_output
                encoding_details['time_remaining'] = eta_from_output
                job.time_remaining = eta_from_output
            
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
                    
                    # Calculate time elapsed
                    if encoding_details['start_timestamp']:
                        time_elapsed = (datetime.now() - encoding_details['start_timestamp']).total_seconds()
                        encoding_details['time_elapsed'] = format_time(time_elapsed)
                        job.time_elapsed = format_time(time_elapsed)
                        
                        # Only calculate ETA if not already extracted from HandBrake
                        if encoding_details['eta'] == '--:--' and encoding_details['current_fps'] > 0:
                            frames_remaining = total_frames - current_frame
                            seconds_remaining = frames_remaining / encoding_details['current_fps']
                            
                            encoding_details['eta'] = format_time(seconds_remaining)
                            encoding_details['time_remaining'] = format_time(seconds_remaining)
                            job.eta = format_time(seconds_remaining)
                            job.time_remaining = format_time(seconds_remaining)
            
            # Alternative progress detection (for HandBrake versions without frame info)
            if "%" in line and "encoding" in line.lower():
                percent_match = re.search(r'(\d+\.\d+|\d+)\s*%', line)
                if percent_match:
                    progress_percent = float(percent_match.group(1))
                    job.progress = progress_percent
                    
                    # Calculate time elapsed
                    if encoding_details['start_timestamp']:
                        time_elapsed = (datetime.now() - encoding_details['start_timestamp']).total_seconds()
                        encoding_details['time_elapsed'] = format_time(time_elapsed)
                        job.time_elapsed = format_time(time_elapsed)
            
            status_message = f"Encoding {job.filename}: {progress_percent:.1f}%"
            
            # Sleep a bit to prevent high CPU usage
            time.sleep(0.01)
        
        # Check if stopped
        if stopped:
            # Process was stopped, clean up
            if current_process:
                try:
                    current_process.terminate()
                    current_process.wait(timeout=2)
                except:
                    try:
                        current_process.kill()
                    except:
                        pass
            
            job.status = "stopped"
            job.error = "Stopped by user"
            job.end_time = datetime.now().isoformat()
            
            encoding_details['encoding_log'].append({
                'timestamp': datetime.now().isoformat(),
                'message': "⏹ Encoding stopped by user",
                'type': 'warning'
            })
            
            # Clean up temp file
            if job.temp_output_path and os.path.exists(job.temp_output_path):
                try:
                    os.remove(job.temp_output_path)
                except:
                    pass
            
            status_message = f"Stopped: {job.filename}"
            
            # Reset current job
            if current_job and current_job.id == job.id:
                current_job = None
            
            # Start next job in queue
            process_queue()
            return
        
        # Wait for process to complete normally
        current_process.wait()
        
        if current_process.returncode == 0:
            # Move from temp to final output
            if os.path.exists(job.temp_output_path):
                shutil.move(job.temp_output_path, final_output_path)
            
            job.status = "completed"
            job.output_size = get_file_size(final_output_path)
            job.current_output_size = job.output_size
            job.progress = 100
            progress_percent = 100
            job.eta = "00:00"
            job.time_remaining = "00:00"
            
            # Add completion message
            encoding_details['encoding_log'].append({
                'timestamp': datetime.now().isoformat(),
                'message': f"✓ Encoding completed successfully. Output saved to {output_filename}",
                'type': 'success'
            })
            
            # Calculate total time
            if encoding_details['start_timestamp']:
                total_time = (datetime.now() - encoding_details['start_timestamp']).total_seconds()
            
            encoding_history.append({
                'filename': job.filename,
                'preset': job.preset,
                'format': job.output_format,
                'input_size': job.input_size,
                'output_size': job.output_size,
                'average_fps': job.average_fps,
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
        if not stopped:  # Only set end time if not stopped
            job.end_time = datetime.now().isoformat()
        
        current_process = None
        
        # Only clear current_job if this is actually the current job
        if current_job and current_job.id == job.id:
            current_job = None
        
        paused = False
        stopped = False
        
        # Clean up temp file if it exists and job failed/cancelled/stopped
        if job.status in ["failed", "cancelled", "stopped"] and job.temp_output_path and os.path.exists(job.temp_output_path):
            try:
                os.remove(job.temp_output_path)
            except:
                pass
        
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

def get_directory_structure(base_path, current_path=None, level=0):
    """Recursively get directory structure"""
    if current_path is None:
        current_path = base_path
    
    items = []
    
    try:
        for item in os.listdir(current_path):
            item_path = os.path.join(current_path, item)
            relative_path = os.path.relpath(item_path, base_path)
            
            if os.path.isdir(item_path):
                # It's a directory
                items.append({
                    'name': item,
                    'type': 'directory',
                    'path': relative_path,
                    'level': level,
                    'children': get_directory_structure(base_path, item_path, level + 1),
                    'size': 0,
                    'size_display': '-',
                    'modified': os.path.getmtime(item_path),
                    'extension': 'folder',
                    'expanded': False
                })
            elif os.path.isfile(item_path):
                # It's a file
                extension = os.path.splitext(item)[1].lower().lstrip('.')
                size = get_file_size(item_path)
                
                items.append({
                    'name': item,
                    'type': 'file',
                    'path': relative_path,
                    'level': level,
                    'children': [],
                    'size': size,
                    'size_display': f"{size} MB",
                    'modified': os.path.getmtime(item_path),
                    'extension': extension if extension else 'unknown',
                    'expanded': False
                })
    except Exception as e:
        print(f"Error reading directory {current_path}: {e}")
    
    return items

@app.route("/")
def index():
    return render_template("index.html")

@app.get("/files")
def list_files():
    try:
        structure = get_directory_structure(MEDIA_DIR)
        return jsonify(structure)
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
            'current_output_size': job.current_output_size if job.status == 'encoding' else job.output_size,
            'current_fps': job.current_fps,
            'average_fps': job.average_fps,
            'time_elapsed': job.time_elapsed,
            'time_remaining': job.time_remaining,
            'eta': job.eta,
            'paused': paused and job.status == 'encoding'
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
            'current_output_size': current_job.current_output_size,
            'current_fps': current_job.current_fps,
            'average_fps': current_job.average_fps,
            'time_elapsed': current_job.time_elapsed,
            'time_remaining': current_job.time_remaining,
            'eta': current_job.eta,
            'paused': paused
        }
    
    return jsonify({
        'queue': queue_data,
        'current': current,
        'status': status_message,
        'progress': progress_percent,
        'paused': paused,
        'stopped': stopped
    })

@app.get("/encoding-details")
def get_encoding_details():
    global encoding_details, current_job
    
    # Calculate size reduction if we have current job
    size_reduction = "-"
    current_output_size_display = "-"
    
    if current_job:
        # Show current output size during encoding
        if current_job.status == 'encoding' and current_job.current_output_size > 0:
            current_output_size_display = f"{current_job.current_output_size} MB"
        elif current_job.output_size > 0:
            current_output_size_display = f"{current_job.output_size} MB"
        
        # Calculate reduction percentage
        if current_job.input_size and current_job.current_output_size:
            reduction = ((current_job.input_size - current_job.current_output_size) / current_job.input_size * 100)
            size_reduction = f"{reduction:.1f}%"
        elif current_job.input_size and current_job.output_size:
            reduction = ((current_job.input_size - current_job.output_size) / current_job.input_size * 100)
            size_reduction = f"{reduction:.1f}%"
        elif current_job.input_size:
            size_reduction = "0%"
    
    return jsonify({
        'current_fps': encoding_details['current_fps'],
        'average_fps': encoding_details['average_fps'],
        'eta': encoding_details['eta_from_output'] if encoding_details['eta_from_output'] != '--:--' else encoding_details['eta'],
        'eta_from_output': encoding_details['eta_from_output'],
        'time_elapsed': encoding_details['time_elapsed'],
        'time_remaining': encoding_details['eta_from_output'] if encoding_details['eta_from_output'] != '--:--' else encoding_details['time_remaining'],
        'encoding_log': encoding_details['encoding_log'][-20:],  # Last 20 entries
        'frames_processed': encoding_details['frames_processed'],
        'total_frames': encoding_details['total_frames'],
        'input_file': current_job.filename if current_job else "-",
        'input_size': f"{current_job.input_size} MB" if current_job and current_job.input_size else "-",
        'output_size': current_output_size_display,
        'size_reduction': size_reduction,
        'preset': current_job.preset if current_job else "-",
        'format': current_job.output_format if current_job else "-",
        'paused': paused,
        'stopped': stopped
    })

@app.get("/history")
def get_history():
    return jsonify(encoding_history[-20:])

@app.post("/queue/add")
def add_to_queue():
    data = request.json
    if not data or "file" not in data or "preset" not in data:
        return jsonify({"error": "Missing file or preset"}), 400
    
    # Check if file already in queue
    for job in encoding_queue:
        if job.filename == data["file"] and job.status in ["queued", "encoding", "paused"]:
            return jsonify({"error": "File already in queue"}), 400
    
    # Get full path for files in subdirectories
    if data.get("path"):
        input_path = os.path.join(MEDIA_DIR, data["path"])
    else:
        input_path = os.path.join(MEDIA_DIR, data["file"])
    
    input_size = get_file_size(input_path) if os.path.exists(input_path) else 0
    
    job_id = int(time.time() * 1000)
    job = EncodingJob(
        job_id,
        data["file"],
        data["preset"],
        data.get("format", "mp4"),
        input_path if data.get("path") else None
    )
    job.input_size = input_size
    
    encoding_queue.append(job)
    
    return jsonify({"status": "added", "id": job_id, "input_size": input_size})

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

@app.post("/start")
def start_encoding():
    global current_job
    
    # Start processing if nothing is running
    if not current_job:
        process_queue()
        return jsonify({"status": "started"})
    
    return jsonify({"status": "already_running"})

@app.post("/pause")
def pause_job():
    global paused, current_job
    paused = True
    
    if current_job and current_job.status == "encoding":
        current_job.status = "paused"
    
    return jsonify({"status": "paused"})

@app.post("/resume")
def resume_job():
    global paused, current_job
    paused = False
    
    if current_job and current_job.status == "paused":
        current_job.status = "encoding"
    
    return jsonify({"status": "resumed"})

@app.post("/cancel")
def cancel_job():
    global current_process, current_job, status_message, paused, stopped
    
    stopped = True
    
    if current_process:
        try:
            # Kill the process
            current_process.terminate()
            try:
                current_process.wait(timeout=5)
            except:
                current_process.kill()
        except:
            pass
        current_process = None
    
    if current_job:
        current_job.status = "cancelled"
        current_job.end_time = datetime.now().isoformat()
        current_job.eta = "--:--"
        current_job.time_remaining = "--:--"
        
        # Add cancellation message
        encoding_details['encoding_log'].append({
            'timestamp': datetime.now().isoformat(),
            'message': "⏹ Encoding cancelled by user",
            'type': 'warning'
        })
        
        # Clean up temp file
        if current_job.temp_output_path and os.path.exists(current_job.temp_output_path):
            try:
                os.remove(current_job.temp_output_path)
            except:
                pass
        
        current_job = None
    
    paused = False
    status_message = "Cancelled"
    progress_percent = 0
    
    # Start next job in queue
    process_queue()
    
    return jsonify({"status": "cancelled"})

@app.post("/stop")
def stop_encoding():
    global current_process, current_job, status_message, paused, stopped
    
    stopped = True
    
    if current_process:
        try:
            # Kill the process
            current_process.terminate()
            try:
                current_process.wait(timeout=2)
            except:
                try:
                    current_process.kill()
                except:
                    pass
        except:
            pass
        current_process = None
    
    if current_job:
        current_job.status = "stopped"
        current_job.end_time = datetime.now().isoformat()
        current_job.eta = "--:--"
        current_job.time_remaining = "--:--"
        
        # Add stop message
        encoding_details['encoding_log'].append({
            'timestamp': datetime.now().isoformat(),
            'message': "⏹ Encoding stopped by user",
            'type': 'warning'
        })
        
        # Clean up temp file
        if current_job.temp_output_path and os.path.exists(current_job.temp_output_path):
            try:
                os.remove(current_job.temp_output_path)
            except:
                pass
        
        current_job = None
    
    paused = False
    status_message = "Stopped"
    progress_percent = 0
    
    # Start next job in queue
    process_queue()
    
    return jsonify({"status": "stopped"})

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
    os.makedirs(TEMP_DIR, exist_ok=True)
    
    app.run(host="0.0.0.0", port=5000, debug=False)