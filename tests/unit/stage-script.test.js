'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { paginateStageScript, navigateStageScript, buildStageScriptPayload, validateStageScriptConfig, assignStageScriptSides, setStageScriptVisibility } = require('../../server/lib/stage-script');

test('paginateStageScript — preserves dialogue lines and wraps long zh-TW lines', () => {
  const pages = paginateStageScript('甲：第一行\n乙：第二行\n' + '丙：'.padEnd(18, '字'), { linesPerPage: 2, charsPerLine: 12 });
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0], ['甲：第一行', '乙：第二行']);
  assert.equal(pages[1].join('').includes('丙：'), true);
});

test('navigateStageScript — clamps previous and next page boundaries', () => {
  assert.equal(navigateStageScript(0, 3, 'previous'), 0);
  assert.equal(navigateStageScript(0, 3, 'next'), 1);
  assert.equal(navigateStageScript(2, 3, 'next'), 2);
});

test('buildStageScriptPayload — makes server pages authoritative for a 1000-character script', () => {
  const payload = buildStageScriptPayload({ text: '甲'.repeat(1000), page: 99, visible: true });
  assert.ok(payload.pageCount >= 4);
  assert.equal(payload.page, payload.pageCount - 1);
  assert.deepEqual(payload.lines.map((line) => line.text), paginateStageScript('甲'.repeat(1000))[payload.page]);
});

test('validateStageScriptConfig — accepts 1-8 roles and counts system as one role', () => {
  assert.deepEqual(validateStageScriptConfig({ actorCount: 3, systemIsActor: true }), { actorCount: 3, systemIsActor: true, humanActorCount: 2 });
  assert.throws(() => validateStageScriptConfig({ actorCount: 0, systemIsActor: false }));
  assert.throws(() => validateStageScriptConfig({ actorCount: 9, systemIsActor: false }));
});

test('validateStageScriptConfig — defaults legacy requests without actor controls to two roles', () => {
  assert.deepEqual(validateStageScriptConfig({}), { actorCount: 2, systemIsActor: false, humanActorCount: 2 });
});

test('assignStageScriptSides — keeps each speaker on a fixed alternating side and centers directions', () => {
  const lines = assignStageScriptSides(['甲：第一句', '乙：第二句', '甲：第三句', '【燈光暗下】']);
  assert.deepEqual(lines, [
    { text: '甲：第一句', side: 'left' },
    { text: '乙：第二句', side: 'right' },
    { text: '甲：第三句', side: 'left' },
    { text: '【燈光暗下】', side: 'center' },
  ]);
});

test('setStageScriptVisibility — hides without discarding a pre-generated script or its page', () => {
  const state = { text: '甲：保留內容', page: 2, visible: true, actorCount: 2, systemIsActor: false };
  assert.deepEqual(setStageScriptVisibility(state, false), { ...state, visible: false });
  assert.deepEqual(setStageScriptVisibility(state, false).text, state.text);
});
