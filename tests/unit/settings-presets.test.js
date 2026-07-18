/**
 * Unit tests for the character preset CRUD logic in server/lib/settings.js.
 * Uses an isolated temp settings file per test run via OURT_SETTINGS_PATH so
 * this never touches the developer's real server/settings.json.
 *
 * Run: node --test tests/unit
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshSettingsModule() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ourt-settings-test-'));
  process.env.OURT_SETTINGS_PATH = path.join(dir, 'settings.json');
  delete process.env.OURT_LEGACY_SETTINGS_PATH;
  delete process.env.OURT_LEGACY_ENV_PATH;
  const modulePath = require.resolve('../../server/lib/settings');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('getPresets — empty by default', () => {
  const settings = freshSettingsModule();
  assert.deepEqual(settings.getPresets(), []);
});

test('savePreset — appends a new preset with a generated id', () => {
  const settings = freshSettingsModule();
  const list = settings.savePreset({
    name: '困惑版',
    voice: 'marin',
    attitude: 'passive',
    emotionalState: 'confused',
    params: { doubt: 7, gender: 5, pressure: 4, label: 6, energy: 3 },
    promptOverride: '',
  });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '困惑版');
  assert.ok(list[0].id, 'preset must be assigned an id');
  assert.equal(list[0].voice, 'marin');
});

test('savePreset — overwrites in place when id matches an existing preset', () => {
  const settings = freshSettingsModule();
  const [created] = settings.savePreset({ name: 'A', voice: 'marin' });
  const updated = settings.savePreset({ id: created.id, name: 'A（已更新）', voice: 'cedar' });
  assert.equal(updated.length, 1, 'overwrite must not create a second entry');
  assert.equal(updated[0].id, created.id);
  assert.equal(updated[0].name, 'A（已更新）');
  assert.equal(updated[0].voice, 'cedar');
});

test('savePreset — appending multiple presets preserves an expandable, ordered list', () => {
  const settings = freshSettingsModule();
  settings.savePreset({ name: '第一' });
  settings.savePreset({ name: '第二' });
  const list = settings.savePreset({ name: '第三' });
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((p) => p.name), ['第一', '第二', '第三']);
});

test('deletePreset — removes only the matching slot', () => {
  const settings = freshSettingsModule();
  const afterCreate1 = settings.savePreset({ name: 'keep-1' });
  const afterCreate2 = settings.savePreset({ name: 'delete-me' });
  const idToDelete = afterCreate2[afterCreate2.length - 1].id;
  const remaining = settings.deletePreset(idToDelete);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].name, 'keep-1');
});

test('savePreset — persists across a reload of the settings cache', () => {
  const settings = freshSettingsModule();
  settings.savePreset({ name: '持久化測試', voice: 'marin' });
  // Force a fresh load from disk by clearing the module's internal cache via
  // a settings update (updateSettings already invalidates settingsCache).
  settings.updateSettings({ ktv: { autoRewrite: false } });
  const list = settings.getPresets();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, '持久化測試');
});

test('savePreset — preserves concise-information mode across overwrite and reload', () => {
  const settings = freshSettingsModule();
  const [created] = settings.savePreset({ name: '資訊整理', conciseInformationMode: true });
  assert.equal(created.conciseInformationMode, true);

  const [updated] = settings.savePreset({ id: created.id, name: '一般對話', conciseInformationMode: false });
  assert.equal(updated.conciseInformationMode, false);

  settings.updateSettings({ ktv: { autoRewrite: false } });
  assert.equal(settings.getPresets()[0].conciseInformationMode, false);
});
