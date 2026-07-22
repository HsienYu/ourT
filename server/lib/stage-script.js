'use strict';

function wrapLine(line, charsPerLine) {
  if (!line) return [''];
  const chars = Array.from(line);
  const wrapped = [];
  for (let index = 0; index < chars.length; index += charsPerLine) {
    wrapped.push(chars.slice(index, index + charsPerLine).join(''));
  }
  return wrapped;
}

function paginateStageScript(text, { linesPerPage = 10, charsPerLine = 30 } = {}) {
  const lines = String(text || '').split(/\r?\n/).flatMap((line) => wrapLine(line, charsPerLine));
  const pages = [];
  for (let index = 0; index < lines.length; index += linesPerPage) pages.push(lines.slice(index, index + linesPerPage));
  return pages.length ? pages : [[]];
}

function navigateStageScript(page, pageCount, direction) {
  if (direction === 'next') return Math.min(page + 1, Math.max(pageCount - 1, 0));
  if (direction === 'previous') return Math.max(page - 1, 0);
  return Math.min(Math.max(page, 0), Math.max(pageCount - 1, 0));
}

function validateStageScriptConfig({ actorCount, systemIsActor }) {
  const count = actorCount === undefined || actorCount === null || actorCount === '' ? 2 : Number(actorCount);
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error('角色人數必須介於 1 到 8');
  return { actorCount: count, systemIsActor: !!systemIsActor, humanActorCount: count - (systemIsActor ? 1 : 0) };
}

function buildStageScriptPayload({ text, page = 0, visible = false }) {
  const pages = paginateStageScript(text);
  const currentPage = navigateStageScript(page, pages.length, 'current');
  const pageStart = pages.slice(0, currentPage).reduce((count, lines) => count + lines.length, 0);
  const annotatedLines = assignStageScriptSides(pages.flat());
  return { text, page: currentPage, pageCount: pages.length, lines: annotatedLines.slice(pageStart, pageStart + pages[currentPage].length), visible };
}

function assignStageScriptSides(lines) {
  const sidesBySpeaker = new Map();
  let nextSide = 'left';
  let previousSide = 'left';
  return lines.map((text) => {
    if (text.startsWith('【')) return { text, side: 'center' };
    const speaker = text.match(/^([^：:]{1,20})[：:]/)?.[1]?.trim();
    if (!speaker) return { text, side: previousSide };
    if (!sidesBySpeaker.has(speaker)) {
      sidesBySpeaker.set(speaker, nextSide);
      nextSide = nextSide === 'left' ? 'right' : 'left';
    }
    previousSide = sidesBySpeaker.get(speaker);
    return { text, side: previousSide };
  });
}

function setStageScriptVisibility(state, visible) {
  return { ...state, visible: !!visible };
}

module.exports = { paginateStageScript, navigateStageScript, validateStageScriptConfig, buildStageScriptPayload, assignStageScriptSides, setStageScriptVisibility };
