/**
 * settings.js
 *
 * Runtime settings persistence. Electron supplies a user-writable path in
 * Application Support; standalone development defaults to server/settings.json.
 * Keys are stored server-side only; never sent to browser in full.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = process.env.OURT_SETTINGS_PATH || path.join(__dirname, '..', 'settings.json');

// lite: only realtime-voice providers, no text-generation providers or KTV
const DEFAULT_SETTINGS = {
  providers: {
    realtimeVoice: 'openai',   // 'openai' | 'gemini'
  },
  models: {
    openaiRealtime: 'gpt-realtime-2.1',
    geminiLive:     'gemini-3.1-flash-live-preview',
    openaiVoice:    'alloy',
    geminiVoice:    'Aoede',
  },
  keys: {
    openai: '',
    gemini: '',
  },
  audio: {
    inputDeviceId: '',
    inputDeviceLabel: '',
    outputDeviceId: '',
    outputDeviceLabel: '',
  },
  characterPresets: [],
};

let settingsCache = null;

/**
 * Deep merge two objects. Mutates target.
 */
function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] !== null &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

/**
 * Load settings from the canonical JSON file. A legacy Electron .env file is
 * imported once only when no canonical settings file exists yet.
 * @returns {object}
 */
function loadSettings() {
  if (settingsCache) return settingsCache;

  let fileSettings = {};
  let loadedFromFile = false;
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    fileSettings = JSON.parse(raw);
    loadedFromFile = true;
  } catch {
    // File does not exist or is invalid JSON — start from defaults.
  }

  // Start with defaults and overlay the canonical settings file.
  settingsCache = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  deepMerge(settingsCache, fileSettings);

  if (!loadedFromFile) migrateLegacySettings();
  // Remove stale fields from older settings files
  let changed = false;
  for (const field of ['ktv', 'aiFeatures', 'yolo']) {
    if (field in settingsCache) { delete settingsCache[field]; changed = true; }
  }
  if (changed) persistSettings();

  return settingsCache;
}

function migrateLegacySettings() {
  let migrated = false;
  const legacySettingsPath = process.env.OURT_LEGACY_SETTINGS_PATH;
  if (legacySettingsPath && fs.existsSync(legacySettingsPath)) {
    try {
      deepMerge(settingsCache, JSON.parse(fs.readFileSync(legacySettingsPath, 'utf8')));
      migrated = true;
    } catch (err) {
      console.warn('[settings] Could not import legacy settings.json:', err.message);
    }
  }

  const legacyPath = process.env.OURT_LEGACY_ENV_PATH;
  if (legacyPath && fs.existsSync(legacyPath)) {
    try {
      const dotenv = require('dotenv');
      const legacy = dotenv.parse(fs.readFileSync(legacyPath));
      const keyMap = {
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        gemini: 'GEMINI_API_KEY',
        groq: 'GROQ_API_KEY',
        mistral: 'MISTRAL_API_KEY',
      };
      for (const [provider, envName] of Object.entries(keyMap)) {
        if (!settingsCache.keys[provider] && legacy[envName]) {
          settingsCache.keys[provider] = legacy[envName];
        }
      }
      migrated = true;
    } catch (err) {
      console.warn('[settings] Could not import legacy .env:', err.message);
    }
  }

  if (migrated) {
    persistSettings();
    console.log(`[settings] Imported legacy configuration into ${SETTINGS_FILE}`);
  }
}

/**
 * Get current settings (lazy-loaded).
 * @returns {object}
 */
function getSettings(maskSecrets = false) {
  const settings = JSON.parse(JSON.stringify(loadSettings()));
  if (maskSecrets) {
    for (const provider of Object.keys(settings.keys)) {
      settings.keys[provider] = maskKey(settings.keys[provider]);
    }
  }
  return settings;
}

/**
 * Get API key for a provider from the canonical settings file.
 * @param {string} provider - 'openai' | 'anthropic' | 'gemini' | 'groq' | 'mistral'
 * @returns {string}
 */
function getApiKey(provider) {
  const settings = loadSettings();
  return settings.keys[provider] || '';
}

/**
 * Deep merge patch into current settings and persist to disk.
 * @param {object} patch - partial settings object to merge
 * @returns {object} updated settings
 */
function updateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('settings patch must be an object');
  }
  // Strip any masked placeholder values so they don't overwrite real keys
  if (patch.keys && typeof patch.keys === 'object') {
    patch = { ...patch, keys: { ...patch.keys } };
    for (const [provider, key] of Object.entries(patch.keys)) {
      if (typeof key === 'string' && (key.includes('***') || key === '')) {
        delete patch.keys[provider];
      }
    }
  }
  // Strip stale fields that no longer exist in lite
  if (patch.ktv || patch.aiFeatures || patch.yolo) {
    patch = { ...patch };
    delete patch.ktv; delete patch.aiFeatures; delete patch.yolo;
  }
  // Ensure cache is populated, then merge in-place and persist
  loadSettings();
  deepMerge(settingsCache, patch);
  persistSettings();
  // Invalidate cache so next read picks up the freshly written file
  settingsCache = null;
  return loadSettings();
}

/**
 * Persist current settings cache to disk.
 */
function persistSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settingsCache, null, 2), 'utf8');
  } catch (err) {
    console.error('[settings] Failed to write settings file:', err.message);
    throw err;
  }
}

/**
 * Mask API key for safe display (show only last 4 chars).
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  const last4 = key.slice(-4);
  return `****...${last4}`;
}

/**
 * Get available providers with key-status info.
 * @returns {object}
 */
function getProviderStatus() {
  const settings = loadSettings();
  return {
    openai: { hasKey: !!settings.keys.openai, name: 'OpenAI' },
    gemini: { hasKey: !!settings.keys.gemini, name: 'Google (Gemini)' },
  };
}

function getProviderOptions() {
  return getProviderStatus();
}



/**
 * Reset settings to defaults (for testing).
 */
function resetSettings() {
  settingsCache = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  persistSettings();
}

// ── Character presets ──────────────────────────────────────────────────────
// Kept separate from the main settings-form save flow (updateSettings) so
// saving a preset never risks touching API keys or provider selection.

/**
 * Get the current list of saved character presets.
 * @returns {Array<object>}
 */
function getPresets() {
  const settings = loadSettings();
  return JSON.parse(JSON.stringify(settings.characterPresets || []));
}

/**
 * Save (create or overwrite) a character preset.
 * @param {object} preset - { id?, name, voice, attitude, emotionalState, params, promptOverride, conciseInformationMode }
 *   If `id` matches an existing preset, that slot is overwritten in place.
 *   Otherwise a new preset is appended with a freshly generated id.
 * @returns {Array<object>} the updated preset list
 */
function savePreset(preset) {
  if (!preset || typeof preset !== 'object') {
    throw new Error('preset must be an object');
  }
  loadSettings();
  const list = settingsCache.characterPresets || (settingsCache.characterPresets = []);
  const entry = {
    id: preset.id || `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: preset.name || '',
    voice: preset.voice || null,
    attitude: preset.attitude || null,
    emotionalState: preset.emotionalState || null,
    params: preset.params || null,
    promptOverride: preset.promptOverride || '',
  };
  const existingIndex = list.findIndex((item) => item.id === entry.id);
  if (existingIndex !== -1) {
    list[existingIndex] = entry;
  } else {
    list.push(entry);
  }
  persistSettings();
  return getPresets();
}

/**
 * Delete a character preset by id.
 * @param {string} id
 * @returns {Array<object>} the updated preset list
 */
function deletePreset(id) {
  loadSettings();
  settingsCache.characterPresets = (settingsCache.characterPresets || []).filter((item) => item.id !== id);
  persistSettings();
  return getPresets();
}

module.exports = {
  loadSettings,
  getSettings,
  updateSettings,
  persistSettings,
  getApiKey,
  maskKey,
  getProviderStatus,
  getProviderOptions,
  resetSettings,
  getPresets,
  savePreset,
  deletePreset,
};
