import { pipeline, env } from '@huggingface/transformers';

// Always use remote models, allow browser cache
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberInstance = null;
let currentModel = null;

async function getTranscriber(modelName, progress_callback) {
  // Re-create if model changed
  if (transcriberInstance && currentModel === modelName) {
    return transcriberInstance;
  }
  transcriberInstance = null;
  currentModel = modelName;

  try {
    // Try WebGPU first
    transcriberInstance = await pipeline('automatic-speech-recognition', modelName, {
      progress_callback,
      device: 'webgpu',
    });
  } catch {
    // Fall back to WASM (required for mobile Safari)
    transcriberInstance = await pipeline('automatic-speech-recognition', modelName, {
      progress_callback,
    });
  }
  return transcriberInstance;
}

self.addEventListener('message', async (event) => {
  const { type, audioData, language, captionMode, isMobile, memoryGB } = event.data;

  if (type === 'generate') {
    try {
      // ── Model selection ──────────────────────────────────────────────────
      // whisper-tiny.en  → English only, smallest possible (mobile + low-RAM)
      // whisper-tiny     → multilingual (needed for Hindi / Hindi detection)
      const needsMultilingual = language === 'hi' || captionMode === 'hinglish' || captionMode === 'hi' || captionMode === 'auto';
      const isLowResource = isMobile || (memoryGB != null && memoryGB < 4);
      const modelName = (isLowResource && !needsMultilingual)
        ? 'Xenova/whisper-tiny.en'
        : 'Xenova/whisper-tiny';

      const transcriber = await getTranscriber(modelName, (x) => {
        if (['progress', 'init', 'download', 'ready'].includes(x.status)) {
          self.postMessage({ type: 'progress', data: x });
        }
      });

      // ── Run transcription with streaming + 120 s hard timeout ────────────
      let partialChunks = [];
      let done = false;

      const transcribePromise = transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: 'word',
        language: language || null,
        // collect every streamed chunk
        chunk_callback: (chunk) => {
          if (chunk && chunk.chunks) {
            partialChunks.push(...chunk.chunks);
          }
        },
      }).then((result) => {
        done = true;
        return result;
      });

      const timeoutPromise = new Promise((resolve) => {
        setTimeout(() => {
          if (!done) {
            // Return whatever we have so far
            resolve({ chunks: partialChunks, text: partialChunks.map(c => c.text).join(' ') });
          }
        }, 120_000);
      });

      const output = await Promise.race([transcribePromise, timeoutPromise]);

      if (!output || !output.chunks || output.chunks.length === 0) {
        self.postMessage({ type: 'error', error: 'No speech detected. Please try a video with clear audio.' });
        return;
      }

      self.postMessage({ type: 'complete', result: output, originalSettings: event.data });

    } catch (err) {
      self.postMessage({ type: 'error', error: err.message });
    }
  }
});
