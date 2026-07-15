/**
 * pcm-processor.js  —  AudioWorklet processor
 *
 * Runs off the main thread. Receives Float32 samples from the mic,
 * converts them to PCM16 (little-endian signed 16-bit), encodes to
 * base64, and posts to the main thread for forwarding to the proxy.
 *
 * Loaded via: audioContext.audioWorklet.addModule('/control/pcm-processor.js')
 *
 * Output rate: 24 000 Hz mono (AudioContext is created at 24 kHz)
 * Chunk size:  128 samples per process() call (~5.3 ms at 24 kHz)
 */

class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const float32 = input[0]; // mono channel
    const pcm16 = floatToPcm16(float32);
    const b64 = arrayBufferToBase64(pcm16.buffer);
    this.port.postMessage(b64);

    return true; // keep processor alive
  }
}

function floatToPcm16(float32Array) {
  const pcm = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32Array[i]));
    pcm[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return pcm;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Process in chunks to avoid call stack limits
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

registerProcessor('pcm-processor', PcmProcessor);
