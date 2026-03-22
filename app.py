import os
import time
import uuid
import threading
import subprocess
import logging
from flask import Flask, request, render_template, jsonify, send_from_directory, redirect, url_for

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024 # 500MB
app.config['UPLOAD_FOLDER'] = 'uploads'
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'mp4', 'mov', 'avi'}

tasks = {}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def cleanup_job():
    """Background job to delete uploads older than 1 hour (3600 seconds)"""
    while True:
        now = time.time()
        for f in os.listdir(app.config['UPLOAD_FOLDER']):
            fpath = os.path.join(app.config['UPLOAD_FOLDER'], f)
            if os.path.isfile(fpath) and os.stat(fpath).st_mtime < now - 3600:
                try:
                    os.remove(fpath)
                except Exception as e:
                    print(f"Error removing {fpath}: {e}")
        time.sleep(600) # check every 10 minutes

# Start the background cleaner daemon
cleanup_thread = threading.Thread(target=cleanup_job, daemon=True)
cleanup_thread.start()

def generate_captions_task(task_id, file_path, filename):
    try:
        tasks[task_id]['status'] = 'processing'
        import whisper
        from whisper.utils import get_writer
        
        # Load model with fp16=False to ensure it runs on CPU without warnings
        model = whisper.load_model("base")
        
        audio_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{task_id}.wav")
        
        # Extract audio from the video using FFmpeg
        subprocess.run(
            ["ffmpeg", "-y", "-i", file_path, "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", audio_path], 
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        
        # Transcribe audio
        result = model.transcribe(audio_path, fp16=False)
        
        # Write VTT and SRT files
        writer_vtt = get_writer("vtt", app.config['UPLOAD_FOLDER'])
        writer_srt = get_writer("srt", app.config['UPLOAD_FOLDER'])
        
        writer_args = {'highlight_words': False, 'max_line_width': 1000, 'max_line_count': 2}
        
        writer_vtt(result, audio_path, **writer_args)
        writer_srt(result, audio_path, **writer_args)
        
        # Set task status to done
        tasks[task_id]['status'] = 'done'
        tasks[task_id]['vtt'] = f"{task_id}.vtt"
        tasks[task_id]['srt'] = f"{task_id}.srt"
        
        # Cleanup temporary audio file
        if os.path.exists(audio_path):
            os.remove(audio_path)
            
    except Exception as e:
        tasks[task_id]['status'] = 'error'
        tasks[task_id]['error'] = str(e)
        app.logger.error(f"Error processing task {task_id}: {e}")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file found.'}), 400
    file = request.files['video']
    if file.filename == '':
        return jsonify({'error': 'No selected file.'}), 400
    if file and allowed_file(file.filename):
        task_id = str(uuid.uuid4())
        ext = file.filename.rsplit('.', 1)[-1]
        filename = f"{task_id}.{ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        tasks[task_id] = {
            'status': 'queued',
            'video_file': filename,
            'original_name': file.filename
        }
        
        # Spawn background processing thread
        thread = threading.Thread(target=generate_captions_task, args=(task_id, filepath, file.filename))
        thread.start()
        
        return jsonify({'task_id': task_id})
    return jsonify({'error': 'Invalid format. Allowed: MP4, MOV, AVI.'}), 400

@app.route('/processing/<task_id>')
def processing(task_id):
    if task_id not in tasks:
        return render_template('index.html', error="Task not found. It may have expired.")
    return render_template('processing.html', task_id=task_id)

@app.route('/status/<task_id>')
def status(task_id):
    if task_id in tasks:
        return jsonify(tasks[task_id])
    return jsonify({'error': 'Task not found'}), 404

@app.route('/result/<task_id>')
def result(task_id):
    if task_id not in tasks or tasks[task_id]['status'] != 'done':
        return redirect(url_for('index'))
    return render_template('result.html', task_id=task_id, video_file=tasks[task_id]['video_file'])

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/download/<task_id>/<fmt>')
def download(task_id, fmt):
    if fmt not in ['srt', 'vtt']:
        return "Invalid format", 400
    filename = f"{task_id}.{fmt}"
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename, as_attachment=True)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
