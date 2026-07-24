(function exposeAudioOutputHelpers(root) {
  'use strict';

  function shouldFlushOutputBacklog(queuedSeconds, maxBacklogSeconds) {
    // Speech must never be silently discarded merely because it arrived ahead
    // of playback. Interrupts and provider/session failures remain the only
    // reasons to flush scheduled output.
    return false;
  }

  function shouldWarnOutputBacklog(queuedSeconds, maxBacklogSeconds) {
    return queuedSeconds > maxBacklogSeconds;
  }

  function buildInputAudioConstraints(deviceId) {
    const constraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (deviceId) constraints.deviceId = { exact: deviceId };
    return constraints;
  }

  function scheduleOutputChunk({ currentTime, nextTime, duration, startDelaySeconds }) {
    const hasQueuedAudio = Number.isFinite(nextTime) && nextTime > currentTime;
    const isInitialChunk = !nextTime;
    const startAt = hasQueuedAudio ? nextTime : currentTime + startDelaySeconds;
    return {
      startAt,
      nextTime: startAt + duration,
      recoveredFromUnderrun: !hasQueuedAudio && !isInitialChunk,
    };
  }

  function rmsFromPcm16(samples) {
    if (!samples || samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += (samples[i] / 32768) ** 2;
    return Math.sqrt(sum / samples.length);
  }

  const helpers = {
    shouldFlushOutputBacklog,
    shouldWarnOutputBacklog,
    buildInputAudioConstraints,
    scheduleOutputChunk,
    rmsFromPcm16,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  root.audioOutputHelpers = helpers;
})(typeof globalThis === 'undefined' ? this : globalThis);
