# Antigravity Captions 🚀✨

A space-themed web application that generates subtitles for your videos in a simulated zero-gravity environment. Elements drift, float, and glow as you navigate the interface, which is styled with immersive, modern tech like glassmorphism and Three.js.

## Features
- **Zero-Gravity Vibe**: Floating 3D space particles, geometric models, and floating glass panels
- **Immersive Custom Cursor**: Glowing neon trail indicating navigation in space
- **Automatic Captioning**: Powered by OpenAI Whisper
- **Holographic Video Player**: Renders captions straight to the browser with downloadable `.srt` and `.vtt` options
- **Smart Cleanup**: Auto-deletes uploads after an hour
- **Supports Large Files**: MP4, AVI, and MOV files up to 500MB
- **Responsive**: Adapts gracefully across desktop and mobile

## Prerequisites

1. **Python 3.9+** Recommended.
2. **FFmpeg** installed and added to your system PATH:
   - *Windows:* Install using `winget install ffmpeg` or download from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)
   - *Mac:* `brew install ffmpeg`
   - *Linux:* `sudo apt install ffmpeg`

## Installation

1. Navigate to this directory in your terminal:
   ```bash
   cd antigravity_captions
   ```

2. Create a virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   # Windows:
   venv\Scripts\activate
   # Mac/Linux:
   source venv/bin/activate
   ```

3. Install requirements:
   ```bash
   pip install -r requirements.txt
   ```

## Running the App

1. Launch it in your terminal with:
   ```bash
   python app.py
   ```

2. Open your web browser and go to `http://localhost:5000`

> **Note**: The first time you upload a video, OpenAI Whisper may download its `base` language model (approx. 140MB). Subsequent uploads will be much faster.

## Tech Stack
- **Backend:** Flask, Python, `openai-whisper`
- **Audio Extract:** `FFmpeg` 
- **Frontend Design:** Vanilla CSS with Neon & Glassmorphism features, Google Fonts (Orbitron, Exo 2)
- **Frontend Interactivity:** Three.js (Starfield & Geometries), Vanilla Tilt.js (Parallax Effects)
