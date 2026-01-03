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

def get_file_size(path):
    """Get file size in MB"""
    if os.path.exists(path):
        return round(os.path.getsize(path) / (1024 * 1024), 2)
    return 0

def run_encode(job):
    global current_process, progress_percent, status_message, current_job
    
    input_path = os.path.join(MEDIA_DIR, job.filename)
    output_filename = os.path.splitext(job.filename)[0] + f".{job.output_format}"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    preset_path = os.path.join(PRESET_DIR, job.preset)
    
    # Get input file size
    job.input_size = get_file_size(input_path)
    
    cmd = [
        "HandBrakeCLI",
        "-i", input_path,
        "-o", output_path,
        "--preset-import-file", preset_path
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
            job.progress = progress_percent
            if "%" in line:
                match = re.search(r'(\d+\.\d+|\d+)\s*%', line)
                if match:
                    progress_percent = float(match.group(1))
                    job.progress = progress_percent
                    status_message = f"Encoding {job.filename}: {progress_percent:.1f}%"
            
            if "Encode done" in line or "Encode Finished" in line:
                progress_percent = 100
                job.progress = 100
        
        current_process.wait()
        
        if current_process.returncode == 0:
            job.status = "completed"
            job.output_size = get_file_size(output_path)
            status_message = f"Completed: {job.filename}"
            encoding_history.append({
                'filename': job.filename,
                'preset': job.preset,
                'input_size': job.input_size,
                'output_size': job.output_size,
                'start_time': job.start_time,
                'end_time': datetime.now().isoformat(),
                'reduction': f"{((job.input_size - job.output_size) / job.input_size * 100):.1f}%" if job.input_size > 0 else "0%"
            })
        else:
            job.status = "failed"
            job.error = "Encoding failed"
            status_message = f"Failed: {job.filename}"
            
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
        status_message = f"Error: {job.filename} - {str(e)}"
    
    finally:
        job.end_time = datetime.now().isoformat()
        current_process = None
        current_job = None
        process_queue()

def process_queue():
    global encoding_queue
    if not encoding_queue and not current_job:
        status_message = "Idle"
        return
    
    if not current_job and encoding_queue:
        next_job = encoding_queue.pop(0)
        thread = threading.Thread(target=run_encode, args=(next_job,))
        thread.daemon = True
        thread.start()

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
                files.append({
                    'name': f,
                    'size': f"{size} MB",
                    'size_raw': size,
                    'modified': modified
                })
        return jsonify(files)
    except:
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
            'progress': job.progress
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
            'output_size': current_job.output_size
        }
    
    return jsonify({
        'queue': queue_data,
        'current': current,
        'status': status_message,
        'progress': progress_percent
    })

@app.get("/history")
def get_history():
    return jsonify(encoding_history[-10:])

@app.post("/queue/add")
def add_to_queue():
    data = request.json
    if not data or "file" not in data or "preset" not in data:
        return jsonify({"error": "Missing file or preset"}), 400
    
    job_id = int(time.time() * 1000)
    job = EncodingJob(
        job_id,
        data["file"],
        data["preset"],
        data.get("format", "mp4")
    )
    
    encoding_queue.append(job)
    
    if not current_job:
        process_queue()
    
    return jsonify({"status": "added", "id": job_id})

@app.post("/queue/remove")
def remove_from_queue():
    data = request.json
    job_id = data.get("id")
    
    global encoding_queue
    encoding_queue = [job for job in encoding_queue if job.id != job_id]
    
    return jsonify({"status": "removed"})

@app.post("/queue/clear")
def clear_queue():
    global encoding_queue
    encoding_queue = []
    return jsonify({"status": "cleared"})

@app.post("/queue/move")
def move_in_queue():
    data = request.json
    job_id = data.get("id")
    direction = data.get("direction")
    
    for i, job in enumerate(encoding_queue):
        if job.id == job_id:
            if direction == "up" and i > 0:
                encoding_queue[i], encoding_queue[i-1] = encoding_queue[i-1], encoding_queue[i]
            elif direction == "down" and i < len(encoding_queue) - 1:
                encoding_queue[i], encoding_queue[i+1] = encoding_queue[i+1], encoding_queue[i]
            break
    
    return jsonify({"status": "moved"})

@app.post("/cancel")
def cancel_job():
    global current_process, current_job, status_message
    
    if current_process:
        current_process.terminate()
        current_process = None
    
    if current_job:
        current_job.status = "cancelled"
        current_job.end_time = datetime.now().isoformat()
        current_job = None
    
    status_message = "Cancelled"
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
    
    net_io = psutil.net_io_counters()
    network = {
        'sent': f"{net_io.bytes_sent / (1024*1024):.1f} MB",
        'recv': f"{net_io.bytes_recv / (1024*1024):.1f} MB"
    }
    
    process_cpu = 0
    process_ram = 0
    if current_process:
        try:
            p = psutil.Process(current_process.pid)
            process_cpu = p.cpu_percent(interval=0.1)
            process_ram = p.memory_info().rss / (1024 * 1024)
        except:
            pass
    
    return jsonify({
        'cpu': cpu,
        'ram': ram,
        'disk': disk,
        'network': network,
        'process_cpu': process_cpu,
        'process_ram': f"{process_ram:.1f} MB",
        'timestamp': datetime.now().strftime("%H:%M:%S")
    })

if __name__ == "__main__":
    os.makedirs(MEDIA_DIR, exist_ok=True)
    os.makedirs(PRESET_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    app.run(host="0.0.0.0", port=5000, debug=False)