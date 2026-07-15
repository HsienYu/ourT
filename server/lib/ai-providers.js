/**
 * ai-providers.js
 *
 * Unified text generation abstraction for multiple LLM providers.
 * Supports: Anthropic (Claude), Google (Gemini), Groq, Mistral, OpenAI.
 *
 * All calls use native fetch (no extra dependencies).
 * Responses normalized to: { text: string }
 */

'use strict';

const { getApiKey } = require('./settings');

/**
 * Make a call to Anthropic Claude Messages API.
 * @param {object} opts
 * @param {string} opts.system - system prompt
 * @param {string} opts.prompt - user message
 * @param {string} opts.model - model name
 * @param {number} [opts.maxTokens=2048]
 * @returns {Promise<string>}
 */
async function callClaude({ system, prompt, model, maxTokens = 2048 }) {
  const apiKey = require('./settings').getApiKey('anthropic');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude API error: ${res.status} - ${err.error?.message || res.statusText}`);
  }

  const json = await res.json();
  return json.content?.[0]?.text || '';
}

/**
 * Make a call to Google Gemini GenerateContent API.
 * @param {object} opts
 * @param {string} opts.system - system instruction
 * @param {string} opts.prompt - user message
 * @param {string} opts.model - model name
 * @param {number} [opts.maxTokens=2048]
 * @returns {Promise<string>}
 */
async function callGemini({ system, prompt, model, maxTokens = 2048 }) {
  const apiKey = require('./settings').getApiKey('gemini');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetch(`${url}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${res.status} - ${err.error?.message || res.statusText}`);
  }

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Make a call to Groq OpenAI-compatible API.
 * @param {object} opts
 * @param {string} opts.system
 * @param {string} opts.prompt
 * @param {string} opts.model
 * @param {number} [opts.maxTokens=2048]
 * @returns {Promise<string>}
 */
async function callGroq({ system, prompt, model, maxTokens = 2048 }) {
  const apiKey = require('./settings').getApiKey('groq');
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Groq API error: ${res.status} - ${err.error?.message || res.statusText}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

/**
 * Make a call to Mistral OpenAI-compatible API.
 * @param {object} opts
 * @param {string} opts.system
 * @param {string} opts.prompt
 * @param {string} opts.model
 * @param {number} [opts.maxTokens=2048]
 * @returns {Promise<string>}
 */
async function callMistral({ system, prompt, model, maxTokens = 2048 }) {
  const apiKey = require('./settings').getApiKey('mistral');
  if (!apiKey) throw new Error('MISTRAL_API_KEY not set');

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Mistral API error: ${res.status} - ${err.message || res.statusText}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

/**
 * Make a call to OpenAI Chat Completions API.
 * @param {object} opts
 * @param {string} opts.system
 * @param {string} opts.prompt
 * @param {string} opts.model
 * @param {number} [opts.maxTokens=2048]
 * @returns {Promise<string>}
 */
async function callOpenAI({ system, prompt, model, maxTokens = 2048 }) {
  const apiKey = require('./settings').getApiKey('openai');
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`OpenAI API error: ${res.status} - ${err.error?.message || res.statusText}`);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content || '';
}

/**
 * Unified text generation entry point.
 * Selects provider based on settings, falls back to first available if preferred fails.
 *
 * @param {object} opts
 * @param {string} opts.task - 'lyricsRewrite' | 'songAnalysis' | 'realtimeVoice' | 'custom'
 * @param {string} opts.system - system prompt
 * @param {string} opts.prompt - user message
 * @param {object} [opts.options] - { maxTokens, model }
 * @returns {Promise<{ text: string, provider: string, model: string }>}
 */
async function generateText({ task, system, prompt, options = {} }) {
  const settings = require('./settings').getSettings(false);

  // Determine provider for this task
  const taskProviderMap = {
    realtimeVoice: 'realtimeVoice',
    lyricsRewrite: 'lyricsRewrite',
    songAnalysis:  'songAnalysis',
  };
  const providerKey = taskProviderMap[task] || 'custom';
  const preferredProvider = settings.providers[providerKey] || 'gemini';

  // Provider priority order (preferred first, then fallbacks with keys)
  const providerOrder = [
    preferredProvider,
    ...['gemini', 'claude', 'groq', 'mistral', 'openai'].filter(p => p !== preferredProvider),
  ].filter(p => {
    const key = p === 'claude' ? 'anthropic' : p;
    return require('./settings').getApiKey(key);
  });

  if (providerOrder.length === 0) {
    throw new Error('No API keys configured for any provider');
  }

  const model = options.model || require('./settings').getSettings(false).models[providerOrder[0].replace('realtime', '')] || 'gemini-2.5-flash';
  const maxTokens = options.maxTokens || 2048;

  let lastError;
  for (const provider of providerOrder) {
    try {
      let text;
      const modelName = options.model || (require('./settings').getSettings(false).models[provider] || 'gemini-2.5-flash');

      switch (provider) {
        case 'claude':
          text = await callClaude({ system, prompt, model: modelName, maxTokens });
          break;
        case 'gemini':
          text = await callGemini({ system, prompt, model: modelName, maxTokens });
          break;
        case 'groq':
          text = await callGroq({ system, prompt, model: modelName, maxTokens });
          break;
        case 'mistral':
          text = await callMistral({ system, prompt, model: modelName, maxTokens });
          break;
        case 'openai':
          text = await callOpenAI({ system, prompt, model: modelName, maxTokens });
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
      return { text, provider, model: modelName };
    } catch (err) {
      lastError = err;
      console.warn(`[ai-providers] ${provider} failed for ${task}: ${err.message}`);
    }
  }

  throw new Error(`All providers failed for ${task}: ${lastError?.message || 'unknown error'}`);
}

/**
 * Specialized helper: rewrite lyrics with variant-specific prompt.
 * @param {object} opts
 * @param {string} opts.variant - 'gender-swap' | 'emotional' | 'distorted' | 'custom'
 * @param {string} opts.lrcText - original LRC text
 * @param {object} opts.song - { title, artist }
 * @param {string} [opts.customPrompt] - custom prompt for 'custom' variant
 * @param {string} [opts.ragContext] - RAG context from server/rag/
 * @returns {Promise<{ text: string, provider: string, model: string }>}
 */
async function rewriteLyrics({ variant, lrcText, song, customPrompt, ragContext }) {
  const rag = ragContext ? `【演出概念背景】\n${ragContext}\n\n` : '';

  const variantPrompts = {
    'gender-swap': `你是一位繁體中文歌詞改編者。根據演出概念背景，將歌詞中的性別詞語進行流動性互換（他↔她↔TA、男↔女、哥↔姐等）。保持 LRC 時間戳記格式和音節數不變（±2字）。只輸出 LRC 內容，不要任何說明。`,
    'emotional': `你是一位繁體中文詩人。根據演出概念背景，將歌詞情緒放大強化，使用更具身體感、脆弱感或衝擊力的語言。保持音節數（±2字）。保持 LRC 時間戳記格式不變。只輸出 LRC 內容，不要任何說明。`,
    'distorted': `你是一位超現實主義繁體中文詩人。根據演出概念背景，將歌詞進行詩意扭曲與異化，打破語義邏輯，引入陌生意象，解構性別與身份預設。保持 LRC 時間戳記格式不變。只輸出 LRC 內容，不要任何說明。`,
  };

  const systemPrompt = rag + (variantPrompts[variant] || customPrompt || '請依照演出概念背景改寫以下歌詞。保持 LRC 時間戳記格式不變。只輸出 LRC 內容。');
  const prompt = `歌曲：《${song.title}》 ${song.artist}\n\n${lrcText}`;

  return generateText({
    task: 'lyricsRewrite',
    system: systemPrompt,
    prompt,
    options: { maxTokens: 2048 },
  });
}

/**
 * Specialized helper: analyze a song request for psychological/cultural interpretation.
 * @param {object} opts
 * @param {object} opts.song - { title, artist }
 * @returns {Promise<{ text: string, provider: string, model: string }>}
 */
async function analyzeSong({ song }) {
  const systemPrompt = `一位觀眾在劇場表演現場點了《${song.title}》（${song.artist}）。請根據這首歌的情感色彩、歌詞主題（若你知道的話）、以及這首歌在台灣流行文化中的意涵，分析這位觀眾可能的心理狀態、情感傾向、或性別文化認同線索。回答用繁體中文，100 字以內，語氣像在旁白，不要條列式。`;

  return generateText({
    task: 'songAnalysis',
    system: systemPrompt,
    prompt: `歌曲：《${song.title}》 ${song.artist}`,
    options: { maxTokens: 300 },
  });
}

module.exports = {
  callClaude,
  callGemini,
  callGroq,
  callMistral,
  callOpenAI,
  generateText,
  rewriteLyrics,
  analyzeSong,
};