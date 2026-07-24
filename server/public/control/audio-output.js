(function exposeAudioOutputHelpers(root) {
  'use strict';

  function shouldFlushOutputBacklog(queuedSeconds, maxBacklogSeconds) {
    return queuedSeconds > maxBacklogSeconds;
  }

  function rmsFromPcm16(samples) {
    if (!samples || samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += (samples[i] / 32768) ** 2;
    return Math.sqrt(sum / samples.length);
  }

  const helpers = { shouldFlushOutputBacklog, rmsFromPcm16 };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  root.audioOutputHelpers = helpers;
})(typeof globalThis === 'undefined' ? this : globalThis);
