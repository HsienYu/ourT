/**
 * pcm-processor.js  —  AudioWorklet processor
 *
 * Runs off the main thread. Receives Float32 samples from the mic,
 * converts them to PCM16 (little-endian signed 16-bit), and transfers the
 * binary buffer to the main thread. Base64 encoding happens on the main
 * thread because AudioWorkletGlobalScope does not reliably expose `btoa`.
 *
 * Loaded via: audioContext.audioWorklet.addModule('/control/pcm-processor.js')
 *
 * Output rate: 24 000 Hz mono, regardless of the hardware/device rate.
 * Chunk size:  128 samples per process() call (~5.3 ms at 24 kHz)
 */

class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const float32 = input[0]; // mono channel
    const resampled = resampleTo24k(float32, sampleRate);
    const pcm16 = floatToPcm16(resampled);
    this.port.postMessage({
      pcm: pcm16.buffer,
      rms: calculateRms(resampled),
      sampleRate: 24000,
    }, [pcm16.buffer]);

    return true; // keep processor alive
  }
}

function resampleTo24k(samples, inputRate) {
  if (inputRate === 24000) return samples;
  const ratio = inputRate / 24000;
  const output = new Float32Array(Math.max(1, Math.floor(samples.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const low = Math.floor(position);
    const high = Math.min(low + 1, samples.length - 1);
    const fraction = position - low;
    output[index] = samples[low] * (1 - fraction) + samples[high] * fraction;
  }
  return output;
}

function calculateRms(samples) {
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

function floatToPcm16(float32Array) {
  const pcm = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32Array[i]));
    pcm[i] = clamped < 0 ? clamped * 32768 : clamped * 32767;
  }
  return pcm;
}

registerProcessor('pcm-processor', PcmProcessor);
