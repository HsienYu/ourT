'use strict';

const MAX_RECONNECT_ATTEMPTS = 3;

function shouldRetryDisconnect({ desired, generation, activeGeneration, attempts }) {
  return desired && generation === activeGeneration && attempts < MAX_RECONNECT_ATTEMPTS;
}

function retryDelayMs(attempts) {
  return Math.min(750 * (2 ** attempts), 3000);
}

module.exports = { MAX_RECONNECT_ATTEMPTS, shouldRetryDisconnect, retryDelayMs };
