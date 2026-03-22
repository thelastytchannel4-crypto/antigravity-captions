# Zero Gravity Captions 🌌

A completely client-side in-browser video caption generation tool using React, FFmpeg.wasm, and Transformers.js (Whisper AI).
Zero backend, zero Python, zero servers, and zero API keys needed!

## Features ✨
- **100% Client-Side:** Everything happens in your browser natively.
- **Space 3D UI:** Dark glowing nebulas, pure CSS particles, and Vanilla Tilt glassmorphism cards.
- **FFmpeg Extraction:** Converts any video up to 500MB into 16kHz audio internally.
- **Whisper AI:** Uses Hugging Face \`Xenova/whisper-tiny\` model to transcribe accurately.
- **SRT & VTT Export:** Perfect for YouTube, Premiere Pro, or local media players.

## Setup & Running 🚀

It's extremely simple to get started. Just ensure you have Node.js installed.

1. Install dependencies (already done if generated):
   \`\`\`bash
   npm install
   \`\`\`

2. Run the application locally:
   \`\`\`bash
   npm run dev
   \`\`\`

3. Open your browser to \`http://localhost:5173/\`.

## Important Tech Notes ⚙️
- Uses Vite's Server Headers to enable \`SharedArrayBuffer\`, which is required for \`@ffmpeg/ffmpeg\` WebAssembly workers to run efficiently.
- Uses Web Workers for Transformers.js so the main UI thread never freezes.
- Pure CSS animations are used for the background to maintain 60FPS without React Three Fiber overhead.
