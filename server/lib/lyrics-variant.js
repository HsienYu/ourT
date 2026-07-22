'use strict';

const { parseLrc } = require('./lyrics-sync');

function effectiveLyricsVariant(song, hasLiveOverride) {
  if (hasLiveOverride) return 'live';
  return song.activeLyricsVariant || 'original';
}

function validateRewriteLrc(originalLrc, rewrittenLrc) {
  const original = parseLrc(originalLrc);
  const rewritten = parseLrc(rewrittenLrc);
  if (!rewritten.length) throw new Error('改寫結果沒有有效的 LRC 時間戳記');
  if (rewritten.length !== original.length) throw new Error('改寫結果的歌詞行數必須與原版一致');
  if (rewritten.every((line, index) => line.text === original[index].text)) {
    throw new Error('改寫結果與原版相同');
  }
  for (let index = 0; index < original.length; index += 1) {
    if (Math.abs(original[index].time - rewritten[index].time) > 0.01) {
      throw new Error('改寫結果必須保留原版 LRC 時間戳記');
    }
  }
  return rewritten;
}

module.exports = { effectiveLyricsVariant, validateRewriteLrc };
