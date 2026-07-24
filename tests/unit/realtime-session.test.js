/**
 * Unit tests for server/lib/realtime-session.js — the pure session payload
 * builders and reconnect decision logic.
 *
 * Reconnect behavior is intentionally NOT symmetric across providers —
 * confirmed by live testing (Gemini's public Live API closes the WebSocket
 * with code 1007 "Request contains an invalid argument" if any live update
 * is attempted, since its entire setup message is one-time). OpenAI only
 * requires a reconnect for a voice change; Gemini requires one for ANY
 * character parameter change. See the correction note at the top of
 * realtime-session.js for the full history of why this isn't symmetric.
 *
 * lite branch: KTV mutual-exclusion helpers and all tool/function-calling
 * builders (response length, song search/import) were removed along with
 * the features that used them.
 *
 * Run: node --test tests/unit
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  needsReconnect,
  buildOpenAIConnectSession,
  buildOpenAIInstructionsUpdate,
  buildGeminiSetup,
  defaultInstructions,
  appendTranscriptTurn,
  buildGeminiSeedTurns,
  buildOpenAISeedItems,
} = require('../../server/lib/realtime-session');

test('needsReconnect — OpenAI only reconnects on a voice change', () => {
  assert.equal(needsReconnect({ provider: 'openai', voiceChanged: true }), true);
  assert.equal(needsReconnect({ provider: 'openai', voiceChanged: false }), false);
});

test('needsReconnect — Gemini always reconnects, even when voice did not change', () => {
  // Gemini's public Live API has no live-update mechanism of any kind — the
  // entire setup message (voice, model, instructions) is one-time.
  assert.equal(needsReconnect({ provider: 'gemini', voiceChanged: false }), true);
  assert.equal(needsReconnect({ provider: 'gemini', voiceChanged: true }), true);
});

test('buildOpenAIConnectSession — nested audio.output.voice schema, includes voice on connect', () => {
  const payload = buildOpenAIConnectSession({ instructions: '測試指令', voice: 'marin' });
  assert.equal(payload.type, 'session.update');
  assert.equal(payload.session.type, 'realtime');
  assert.equal(payload.session.audio.output.voice, 'marin');
  assert.equal(payload.session.audio.input.format.rate, 24000);
  assert.equal(payload.session.instructions, '測試指令');
  // zh-TW transcription hint must always be present
  assert.match(payload.session.audio.input.transcription.prompt, /臺灣繁體中文/);
  assert.equal(payload.session.audio.input.transcription.language, 'zh');
});

test('buildOpenAIConnectSession — defaults to alloy voice and zh-TW instructions when unset', () => {
  const payload = buildOpenAIConnectSession({});
  assert.equal(payload.session.audio.output.voice, 'alloy');
  assert.match(payload.session.instructions, /臺灣繁體中文/);
});

test('buildOpenAIConnectSession — no tools field exists (lite has no function calling)', () => {
  const payload = buildOpenAIConnectSession({ instructions: '測試' });
  assert.equal('tools' in payload.session, false);
  assert.equal('tool_choice' in payload.session, false);
});

test('buildOpenAIInstructionsUpdate — never includes a voice field', () => {
  const payload = buildOpenAIInstructionsUpdate({ instructions: '新指令' });
  assert.equal(payload.type, 'session.update');
  assert.equal(payload.session.type, 'realtime');
  assert.equal(payload.session.instructions, '新指令');
  assert.equal(payload.session.audio, undefined, 'voice/audio must never appear in a live update — OpenAI rejects the whole update once assistant audio is present');
  assert.equal('voice' in payload.session, false);
});

test('buildGeminiSetup — voice, model, and instructions all live only in the one-time setup message', () => {
  const payload = buildGeminiSetup({ instructions: '測試', voiceName: 'Kore', modelName: 'gemini-3.1-flash-live-preview' });
  assert.equal(payload.setup.model, 'models/gemini-3.1-flash-live-preview');
  assert.equal(payload.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
  assert.equal(payload.setup.systemInstruction.parts[0].text, '測試');
  assert.ok(payload.setup.inputAudioTranscription);
  assert.ok(payload.setup.outputAudioTranscription);
});

test('buildGeminiSetup — no tools field exists (lite has no function calling)', () => {
  const payload = buildGeminiSetup({ instructions: '測試' });
  assert.equal('tools' in payload.setup, false);
});

test('realtime-session module does not export any Gemini live-update builder', () => {
  // Regression guard: a Gemini "instructions update" builder was removed
  // after live testing showed it breaks the connection (1007 error). Make
  // sure it never quietly comes back.
  const moduleExports = require('../../server/lib/realtime-session');
  assert.equal('buildGeminiInstructionsUpdate' in moduleExports, false);
});

test('realtime-session module exports no tool/function-calling builders (lite)', () => {
  const moduleExports = require('../../server/lib/realtime-session');
  for (const removed of [
    'didKtvStart', 'didKtvEnd',
    'responseLengthInstruction', 'buildResponseLengthTool', 'buildResponseLengthFunctionDeclaration',
    'buildSearchSongTool', 'buildSearchSongFunctionDeclaration',
    'buildImportSongTool', 'buildImportSongFunctionDeclaration',
  ]) {
    assert.equal(removed in moduleExports, false, `${removed} must not be exported in lite`);
  }
});

test('defaultInstructions — always enforces Taiwan Traditional Chinese, never Simplified', () => {
  const text = defaultInstructions();
  assert.match(text, /臺灣繁體中文/);
  assert.match(text, /避免簡體字與中國大陸用語/);
});

test('OpenAI connect and Gemini setup both accept the same instructions text unchanged', () => {
  const instructions = '共用的指令文字，用於驗證兩個提供者都收到相同內容。';
  const openaiPayload = buildOpenAIConnectSession({ instructions, voice: 'cedar' });
  const geminiPayload = buildGeminiSetup({ instructions, voiceName: 'Puck' });
  assert.equal(openaiPayload.session.instructions, instructions);
  assert.equal(geminiPayload.setup.systemInstruction.parts[0].text, instructions);
});

// ── Short-term rolling memory (appended when a reconnect must not lose the ────
// ── recent conversation — Gemini parameter changes or OpenAI voice changes) ──

test('appendTranscriptTurn — appends a turn and keeps history within maxTurns', () => {
  let history = [];
  history = appendTranscriptTurn(history, { role: 'user', text: '第一句' }, 3);
  history = appendTranscriptTurn(history, { role: 'ai', text: '回應一' }, 3);
  history = appendTranscriptTurn(history, { role: 'user', text: '第二句' }, 3);
  assert.deepEqual(history, [
    { role: 'user', text: '第一句' },
    { role: 'ai', text: '回應一' },
    { role: 'user', text: '第二句' },
  ]);
});

test('appendTranscriptTurn — drops the oldest turn once over the cap (bounded, "short" memory)', () => {
  let history = [];
  for (let i = 1; i <= 5; i += 1) {
    history = appendTranscriptTurn(history, { role: 'user', text: `第${i}句` }, 3);
  }
  assert.equal(history.length, 3);
  assert.deepEqual(history.map((t) => t.text), ['第3句', '第4句', '第5句']);
});

test('appendTranscriptTurn — ignores empty/whitespace-only text without growing history', () => {
  let history = [];
  history = appendTranscriptTurn(history, { role: 'user', text: '   ' }, 5);
  history = appendTranscriptTurn(history, { role: 'ai', text: '' }, 5);
  assert.deepEqual(history, []);
});

test('appendTranscriptTurn — does not mutate the original array (pure)', () => {
  const original = [{ role: 'user', text: 'A' }];
  const updated = appendTranscriptTurn(original, { role: 'ai', text: 'B' }, 5);
  assert.equal(original.length, 1, 'original array must be untouched');
  assert.equal(updated.length, 2);
});

test('buildGeminiSeedTurns — maps history to raw clientContent turns with turnComplete true', () => {
  const history = [
    { role: 'user', text: '第一句' },
    { role: 'ai', text: '回應一' },
  ];
  const seed = buildGeminiSeedTurns(history);
  assert.deepEqual(seed, {
    clientContent: {
      turns: [
        { role: 'user', parts: [{ text: '第一句' }] },
        { role: 'model', parts: [{ text: '回應一' }] },
      ],
      turnComplete: true,
    },
  });
});

test('buildGeminiSeedTurns — returns null for empty history (nothing to seed)', () => {
  assert.equal(buildGeminiSeedTurns([]), null);
  assert.equal(buildGeminiSeedTurns(undefined), null);
});

test('buildOpenAISeedItems — maps history to conversation.item.create payloads', () => {
  // Content type differs by role per OpenAI's Realtime schema: user messages
  // use 'input_text', assistant messages use 'output_text' — using the wrong
  // one for either role is a real, easy-to-miss mistake.
  const history = [
    { role: 'user', text: '第一句' },
    { role: 'ai', text: '回應一' },
  ];
  const items = buildOpenAISeedItems(history);
  assert.deepEqual(items, [
    {
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '第一句' }] },
    },
    {
      type: 'conversation.item.create',
      item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '回應一' }] },
    },
  ]);
});

test('buildOpenAISeedItems — returns an empty array for empty history', () => {
  assert.deepEqual(buildOpenAISeedItems([]), []);
  assert.deepEqual(buildOpenAISeedItems(undefined), []);
});
