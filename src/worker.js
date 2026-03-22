import { pipeline, env } from '@huggingface/transformers';

// Disable local models
env.allowLocalModels = false;

// Pre-load singleton
class PipelineSingleton {
  static task = 'automatic-speech-recognition';
  static model = 'Xenova/whisper-tiny';
  static instance = null;

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      this.instance = await pipeline(this.task, this.model, {
        progress_callback,
        device: 'webgpu', // Try WebGPU if available
      }).catch(err => {
        // Fallback to WASM
        return pipeline(this.task, this.model, {
          progress_callback,
        });
      });
    }
    return this.instance;
  }
}

// Listen for messages from the main thread
self.addEventListener('message', async (event) => {
  const { type, audioData } = event.data;

  if (type === 'load') {
    try {
      await PipelineSingleton.getInstance((x) => {
        self.postMessage({ type: 'progress', data: x });
      });
      self.postMessage({ type: 'loaded' });
    } catch (error) {
      self.postMessage({ type: 'error', error: error.message });
    }
  }

  if (type === 'generate') {
    try {
      let transcriber = await PipelineSingleton.getInstance((x) => {
        if (x.status === 'progress' || x.status === 'init' || x.status === 'download') {
           self.postMessage({ type: 'progress', data: x });
        }
      });

      let partialOutput = { chunks: [] };
      let isCompleted = false;

      const transcriberPromise = transcriber(audioData, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: 'word',
        language: event.data.language || undefined,
        chunk_callback: (chunk) => {
           if (chunk) partialOutput.chunks.push(chunk);
        }
      }).then(res => {
         isCompleted = true;
         return res;
      });

      const timeoutPromise = new Promise((resolve) => {
         setTimeout(() => {
            if (!isCompleted) {
               resolve(partialOutput);
            }
         }, 60000);
      });

      const output = await Promise.race([transcriberPromise, timeoutPromise]);

      self.postMessage({ type: 'complete', result: output, originalSettings: event.data });
    } catch (error) {
      self.postMessage({ type: 'error', error: error.message });
    }
  }
});
