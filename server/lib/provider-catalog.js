/**
 * provider-catalog.js
 *
 * Voice and model catalogs for OpenAI and Gemini.
 *
 * Voices: neither provider exposes a live "list voices" API — both catalogs
 * are fixed enums documented in each provider's own docs. These lists are the
 * full, current, accurate catalogs (not a subset), refreshed against each
 * provider's documentation. OpenAI's Realtime voice list intentionally
 * excludes `fable`/`onyx`/`nova`, which are TTS-only voices not confirmed
 * working on the current Realtime model, and flags `marin`/`cedar` as
 * recommended per OpenAI's own guidance.
 *
 * Models: both providers DO expose a real, live, queryable model list. This
 * module fetches those live, cached briefly in memory, with a graceful
 * fallback to a static seed list on any failure (no key configured yet,
 * network error, rate limit) so the Settings UI never breaks.
 */

'use strict';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes


// ── Static voice catalogs (no live endpoint exists for either provider) ─────

const OPENAI_REALTIME_VOICES = [
  { id: 'marin',   label: '推薦', note: '最新／最自然' },
  { id: 'cedar',   label: '推薦', note: '最新／最自然' },
  { id: 'alloy',   label: '中性' },
  { id: 'ash',     label: '中性偏男' },
  { id: 'ballad',  label: '柔和' },
  { id: 'coral',   label: '溫暖女' },
  { id: 'echo',    label: '中性偏男' },
  { id: 'sage',    label: '沉穩' },
  { id: 'shimmer', label: '溫柔女' },
  { id: 'verse',   label: '表現力強' },
];

const GEMINI_LIVE_VOICES = [
  { id: 'Zephyr', label: '明亮' }, { id: 'Puck', label: '活潑' }, { id: 'Charon', label: '知性' },
  { id: 'Kore', label: '堅定' }, { id: 'Fenrir', label: '興奮' }, { id: 'Leda', label: '年輕' },
  { id: 'Orus', label: '堅定' }, { id: 'Aoede', label: '輕快' }, { id: 'Callirrhoe', label: '隨和' },
  { id: 'Autonoe', label: '明亮' }, { id: 'Enceladus', label: '氣音' }, { id: 'Iapetus', label: '清晰' },
  { id: 'Umbriel', label: '隨和' }, { id: 'Algieba', label: '柔順' }, { id: 'Despina', label: '柔順' },
  { id: 'Erinome', label: '清晰' }, { id: 'Algenib', label: '沙啞' }, { id: 'Rasalgethi', label: '知性' },
  { id: 'Laomedeia', label: '活潑' }, { id: 'Achernar', label: '輕柔' }, { id: 'Alnilam', label: '堅定' },
  { id: 'Schedar', label: '平穩' }, { id: 'Gacrux', label: '成熟' }, { id: 'Pulcherrima', label: '直接' },
  { id: 'Achird', label: '友善' }, { id: 'Zubenelgenubi', label: '隨性' }, { id: 'Vindemiatrix', label: '溫和' },
  { id: 'Sadachbia', label: '生動' }, { id: 'Sadaltager', label: '博學' }, { id: 'Sulafat', label: '溫暖' },
];

// ── Static model fallback seeds (used when a live fetch fails) ──────────────

const FALLBACK_MODELS = {
  openaiRealtime: ['gpt-realtime-2.1', 'gpt-realtime-2', 'gpt-realtime'],
  gemini:         ['gemini-3.5-flash'],
  geminiLive:     ['gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-preview'],
};

// ── In-memory cache ───────────────────────────────────────────────────────

const cache = new Map(); // key -> { fetchedAt, data }

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  cache.set(key, { fetchedAt: Date.now(), data });
}

/**
 * Clear the in-memory model cache (used by tests; also useful after an API
 * key changes so the next lookup reflects the new account's models).
 */
function clearCache() {
  cache.clear();
}

// ── Live model fetching ───────────────────────────────────────────────────

/**
 * Fetch live models from OpenAI's account-scoped model list, filtered to
 * those that look realtime/audio-capable. Falls back to a static seed list
 * on any error or missing key. `fetchImpl` is injectable for testing.
 * @param {string} apiKey
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string[]>}
 */
async function fetchOpenAIRealtimeModels(apiKey, fetchImpl = fetch) {
  if (!apiKey) return FALLBACK_MODELS.openaiRealtime;
  const cacheKey = `openai:${apiKey.slice(-8)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchImpl('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenAI models list failed: ${res.status}`);
    const json = await res.json();
    const ids = (json.data || [])
      .map((model) => model.id)
      .filter((id) => /^gpt-realtime/i.test(id))
      .sort();
    const result = ids.length > 0 ? ids : FALLBACK_MODELS.openaiRealtime;
    setCached(cacheKey, result);
    return result;
  } catch (error) {
    console.warn('[provider-catalog] OpenAI model fetch failed, using fallback:', error.message);
    return FALLBACK_MODELS.openaiRealtime;
  }
}

/**
 * Fetch live models from Gemini's models.list endpoint, filtered by kind.
 * Falls back to a static seed list on any error or missing key.
 * @param {string} apiKey
 * @param {'text'|'live'} kind - 'text' filters for generateContent models,
 *   'live' filters for bidiGenerateContent (Live API) models.
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string[]>}
 */
async function fetchGeminiModels(apiKey, kind, fetchImpl = fetch) {
  const fallback = kind === 'live' ? FALLBACK_MODELS.geminiLive : FALLBACK_MODELS.gemini;
  if (!apiKey) return fallback;
  const cacheKey = `gemini:${kind}:${apiKey.slice(-8)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`);
    if (!res.ok) throw new Error(`Gemini models list failed: ${res.status}`);
    const json = await res.json();
    const wantedAction = kind === 'live' ? 'bidiGenerateContent' : 'generateContent';
    const names = (json.models || [])
      .filter((model) => (model.supportedGenerationMethods || []).includes(wantedAction))
      .map((model) => (model.name || '').replace(/^models\//, ''))
      .filter(Boolean)
      .sort();
    const result = names.length > 0 ? names : fallback;
    setCached(cacheKey, result);
    return result;
  } catch (error) {
    console.warn(`[provider-catalog] Gemini ${kind} model fetch failed, using fallback:`, error.message);
    return fallback;
  }
}

module.exports = {
  OPENAI_REALTIME_VOICES,
  GEMINI_LIVE_VOICES,
  FALLBACK_MODELS,
  fetchOpenAIRealtimeModels,
  fetchGeminiModels,
  clearCache,
};
