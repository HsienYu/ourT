/**
 * Unit tests for server/lib/provider-catalog.js — live model fetching with
 * caching and graceful fallback, plus the static voice catalogs.
 *
 * Run: node --test tests/unit
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OPENAI_REALTIME_VOICES,
  GEMINI_LIVE_VOICES,
  FALLBACK_MODELS,
  fetchOpenAIRealtimeModels,
  fetchGeminiModels,
  clearCache,
} = require('../../server/lib/provider-catalog');

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test.beforeEach(() => clearCache());

test('OPENAI_REALTIME_VOICES — excludes fable/onyx/nova, includes marin and cedar as recommended', () => {
  const ids = OPENAI_REALTIME_VOICES.map((v) => v.id);
  assert.ok(ids.includes('marin'));
  assert.ok(ids.includes('cedar'));
  assert.ok(!ids.includes('fable'));
  assert.ok(!ids.includes('onyx'));
  assert.ok(!ids.includes('nova'));
  const marin = OPENAI_REALTIME_VOICES.find((v) => v.id === 'marin');
  assert.equal(marin.label, '推薦');
});

test('GEMINI_LIVE_VOICES — full 30-voice catalog', () => {
  assert.equal(GEMINI_LIVE_VOICES.length, 30);
  assert.ok(GEMINI_LIVE_VOICES.some((v) => v.id === 'Puck'));
  assert.ok(GEMINI_LIVE_VOICES.some((v) => v.id === 'Sulafat'));
});

test('fetchOpenAIRealtimeModels — no key returns the static fallback', async () => {
  const result = await fetchOpenAIRealtimeModels('', async () => jsonResponse({ data: [] }));
  assert.deepEqual(result, FALLBACK_MODELS.openaiRealtime);
});

test('fetchOpenAIRealtimeModels — filters live results to realtime voice-agent models only', async () => {
  const fakeFetch = async () => jsonResponse({
    data: [
      { id: 'gpt-realtime-2.1' },
      { id: 'gpt-4o-mini' },
      { id: 'gpt-audio-1.5' },
      { id: 'text-embedding-3-small' },
    ],
  });
  const result = await fetchOpenAIRealtimeModels('sk-test-key', fakeFetch);
  assert.deepEqual(result, ['gpt-realtime-2.1']);
});

test('fetchOpenAIRealtimeModels — falls back to static list on HTTP error', async () => {
  const fakeFetch = async () => jsonResponse({}, false, 401);
  const result = await fetchOpenAIRealtimeModels('sk-bad-key', fakeFetch);
  assert.deepEqual(result, FALLBACK_MODELS.openaiRealtime);
});

test('fetchOpenAIRealtimeModels — falls back to static list when fetch throws (network error)', async () => {
  const fakeFetch = async () => { throw new Error('network down'); };
  const result = await fetchOpenAIRealtimeModels('sk-test-key', fakeFetch);
  assert.deepEqual(result, FALLBACK_MODELS.openaiRealtime);
});

test('fetchOpenAIRealtimeModels — caches successful results, does not refetch within TTL', async () => {
  let callCount = 0;
  const fakeFetch = async () => {
    callCount += 1;
    return jsonResponse({ data: [{ id: 'gpt-realtime-2.1' }] });
  };
  await fetchOpenAIRealtimeModels('sk-cache-key', fakeFetch);
  await fetchOpenAIRealtimeModels('sk-cache-key', fakeFetch);
  assert.equal(callCount, 1, 'second call within TTL must be served from cache');
});

test('fetchGeminiModels — text kind filters generateContent models', async () => {
  const fakeFetch = async () => jsonResponse({
    models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
    ],
  });
  const result = await fetchGeminiModels('key', 'text', fakeFetch);
  assert.deepEqual(result, ['gemini-2.5-flash']);
});

test('fetchGeminiModels — live kind filters bidiGenerateContent models', async () => {
  const fakeFetch = async () => jsonResponse({
    models: [
      { name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['bidiGenerateContent'] },
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    ],
  });
  const result = await fetchGeminiModels('key', 'live', fakeFetch);
  assert.deepEqual(result, ['gemini-3.1-flash-live-preview']);
});

test('fetchGeminiModels — no key returns the appropriate static fallback', async () => {
  const textResult = await fetchGeminiModels('', 'text', async () => jsonResponse({ models: [] }));
  const liveResult = await fetchGeminiModels('', 'live', async () => jsonResponse({ models: [] }));
  assert.deepEqual(textResult, FALLBACK_MODELS.gemini);
  assert.deepEqual(liveResult, FALLBACK_MODELS.geminiLive);
});

test('FALLBACK_MODELS — excludes the retired Gemini 2.5 text models', () => {
  assert.equal(FALLBACK_MODELS.gemini.some((model) => model.startsWith('gemini-2.5-')), false);
  assert.ok(FALLBACK_MODELS.gemini.includes('gemini-3.5-flash'));
});

test('provider-catalog module exports no text-model fetcher (lite has no text-generation providers)', () => {
  const moduleExports = require('../../server/lib/provider-catalog');
  assert.equal('fetchTextModels' in moduleExports, false);
});

test('fetchGeminiModels — falls back on error', async () => {
  const fakeFetch = async () => { throw new Error('boom'); };
  const result = await fetchGeminiModels('key', 'live', fakeFetch);
  assert.deepEqual(result, FALLBACK_MODELS.geminiLive);
});
