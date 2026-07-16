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

const DEFAULT_SETTINGS = {
  providers: {
    realtimeVoice: 'openai',   // 'openai' | 'gemini'
    lyricsRewrite: 'gemini',   // 'claude' | 'gemini' | 'groq' | 'mistral'
    songAnalysis:  'gemini',   // 'claude' | 'gemini' | 'groq' | 'mistral'
  },
  models: {
    claude:         'claude-sonnet-4-5',
    gemini:         'gemini-2.5-flash',
    groq:           'llama-3.3-70b-versatile',
    mistral:        'mistral-large-latest',
    openai:         'gpt-4.1-mini',
    openaiRealtime: 'gpt-realtime-2.1',
    geminiLive:     'gemini-3.1-flash-live-preview',
    openaiVoice:    'alloy',
    geminiVoice:    'Aoede',
  },
  keys: {
    openai:    '',
    anthropic: '',
    gemini:    '',
    groq:      '',
    mistral:   '',
  },
  ktv: {
    autoRewrite:    false,
    defaultVariant: 'gender-swap',
  },
  yolo: {
    confidence: 0.45,
    model:      'yolov8n.pt',
    fpsTarget:  30,
  },
  audio: {
    inputDeviceId: '',
    inputDeviceLabel: '',
    outputDeviceId: '',
    outputDeviceLabel: '',
  },
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
    openai:    { hasKey: !!settings.keys.openai,    name: 'OpenAI' },
    anthropic: { hasKey: !!settings.keys.anthropic, name: 'Anthropic (Claude)' },
    gemini:    { hasKey: !!settings.keys.gemini,    name: 'Google (Gemini)' },
    groq:      { hasKey: !!settings.keys.groq,      name: 'Groq' },
    mistral:   { hasKey: !!settings.keys.mistral,   name: 'Mistral' },
  };
}

function getProviderOptions() {
  return getProviderStatus();
}

function getGeminiLiveVoices() {
  return getModelsForProvider('geminiVoice');
}

/**
 * Get available models for a provider.
 * @param {string} provider
 * @returns {string[]}
 */
function getModelsForProvider(provider) {
  const settings = loadSettings();
  const base = settings.models;

  const modelLists = {
    openai:    [base.openaiRealtime, 'gpt-realtime-2.1'],
    gemini:    [base.gemini, 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3.5-flash'],
    claude:    ['claude-sonnet-4-5', 'claude-opus-4', 'claude-haiku-4-5'],
    groq:      ['llama-3.3-70b-versatile', 'llama-4-scout', 'qwen3-32b'],
    mistral:   ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    geminiLive: [base.geminiLive, 'gemini-2.5-flash-native-audio-preview'],
    openaiVoice: [base.openaiVoice, 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    geminiVoice: [base.geminiVoice, 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda'],
  };

  return modelLists[provider] || [];
}

/**
 * Reset settings to defaults (for testing).
 */
function resetSettings() {
  settingsCache = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  persistSettings();
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
  getGeminiLiveVoices,
  getModelsForProvider,
  resetSettings,
};
