import { readFileSync } from 'node:fs';
import { indexById } from '../app/js/core/ledger.js';

export function loadSample() {
  const doc = JSON.parse(readFileSync(new URL('./fixtures/library.sample.json', import.meta.url), 'utf8'));
  return { doc, foods: indexById(doc.foods), presets: indexById(doc.presets) };
}

// 固定的 id 產生器，讓測試結果可重現
export function idSeq(prefix = 'id') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export const NOW = new Date(2026, 9, 21, 12, 40);
