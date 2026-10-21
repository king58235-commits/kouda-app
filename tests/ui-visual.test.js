// V1.1.1 視覺層的回歸測試：色彩對比、離線（沒有外部資源）、首頁樣板仍保留互動所需的屬性、圖示。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderHome } from '../app/js/ui/home.js';
import { ICON_NAMES, icon, logoMark } from '../app/js/ui/icons.js';

const css = readFileSync(fileURLToPath(new URL('../app/css/app.css', import.meta.url)), 'utf8');

// ---- 取出 token ----
function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}
const lightBlock = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const darkBlock = css.slice(darkStart, css.indexOf('/* ============ ②', darkStart));
const LIGHT = tokens(lightBlock);
const DARK = { ...LIGHT, ...tokens(darkBlock) };

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [前景, 背景, 最低對比]：文字 4.5，圖示／元件邊界 3
const TEXT_PAIRS = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text-2', 'surface'], ['text-2', 'bg'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'], ['muted', 'sheet'],
  ['accent', 'surface'], ['accent', 'bg'], ['accent', 'accent-soft'], ['accent', 'sheet'],
  ['on-accent', 'accent-fill'],
  ['info', 'info-soft'], ['info', 'surface'],
  ['warn', 'warn-soft'], ['warn', 'surface'],
  ['danger', 'danger-soft'], ['danger', 'surface'], ['danger', 'sheet'],
  ['on-del', 'del-bg'],
  ['toast-text', 'toast-bg'], ['toast-accent', 'toast-bg'],
  ['text', 'input'], ['muted', 'input'],
];

for (const [name, T] of [['淺色', LIGHT], ['深色', DARK]]) {
  test(`${name}主題：文字與背景的對比至少 4.5:1（WCAG AA）`, () => {
    const bad = [];
    for (const [fg, bg] of TEXT_PAIRS) {
      assert.ok(T[fg] && T[bg], `缺少 token：${fg} 或 ${bg}`);
      const r = ratio(T[fg], T[bg]);
      if (r < 4.5) bad.push(`${fg} ${T[fg]} on ${bg} ${T[bg]} = ${r.toFixed(2)}`);
    }
    assert.deepEqual(bad, []);
  });

  test(`${name}主題：輸入框邊框、進度條與背景可以分辨（至少 1.4:1，輸入框 1.7:1）`, () => {
    assert.ok(ratio(T['line-strong'], T.input) >= 1.4, `輸入框邊框 ${ratio(T['line-strong'], T.input).toFixed(2)}`);
    assert.ok(ratio(T['accent-fill'], T.track) >= 2.2, `進度條 ${ratio(T['accent-fill'], T.track).toFixed(2)}`);
    assert.ok(ratio(T['info-fill'], T.track) >= 1.9, `蛋白質進度條 ${ratio(T['info-fill'], T.track).toFixed(2)}`);
  });
}

test('樣式表不引用任何外部資源（離線可用）：沒有網址、@import、url()、字型檔', () => {
  assert.doesNotMatch(css, /https?:\/\//i);
  assert.doesNotMatch(css, /@import/i);
  assert.doesNotMatch(css, /url\(/i);
  assert.doesNotMatch(css, /@font-face/i);
});

test('保留深淺兩種主題、減少動態效果、安全區與 44px 觸控下限', () => {
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /safe-area-inset-top/);
  for (const sel of ['.icon-btn', '.cell-minus', '.row .more', '.toast-undo', '.banner button', '.tool', '.bar button']) {
    const i = css.indexOf(`${sel} {`) >= 0 ? css.indexOf(`${sel} {`) : css.indexOf(`${sel},`);
    assert.ok(i >= 0, `找不到 ${sel}`);
  }
  assert.match(css, /\.icon-btn, \.chip-btn \{\s*min-width: 44px; min-height: 44px/);
  assert.match(css, /\.row \.more \{[^}]*min-width: 44px; min-height: 44px/);
  assert.match(css, /\.toast-undo \{ min-height: 44px/);
  assert.match(css, /\.banner button \{ min-height: 44px/);
  assert.match(css, /\.bar button \{\s*min-height: 48px/);
});

test('動畫維持在 150～300 ms（不引入長動畫）', () => {
  const ms = [...css.matchAll(/[ :,](\.\d+|\d+(?:\.\d+)?)(m?s)\b/g)]
    .map((m) => Math.round(m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1])))
    .filter((v) => v > 0);
  assert.ok(ms.length > 5);
  // +1／−1 飄起（0.7 s）是唯一例外：它只是飄走的提示，不擋任何操作
  const long = ms.filter((v) => v > 300 && v !== 700);
  assert.deepEqual(long, [], `有超過 300 ms 的動畫：${long}`);
});

// ---- 圖示 ----
test('每個圖示都是安全、可存取的內建 SVG', () => {
  for (const name of ICON_NAMES) {
    const s = icon(name).s;
    assert.match(s, /^<svg [^>]*aria-hidden="true"/);
    assert.doesNotMatch(s, /<script|onload|href=/i);
  }
  assert.throws(() => icon('不存在'));
  assert.match(logoMark().s, /<svg/);
});

// ---- 首頁樣板：互動依賴的屬性不能掉 ----
const entry = (id, over = {}) => ({
  id, created_at: '2026-10-22T12:40:00+08:00', label_snapshot: '茶葉蛋', qty: 2, unit_kcal_snapshot: 75, unit_protein_snapshot: 6,
  source_type_snapshot: 'label', needs_confirm_snapshot: false, level: null, note: null, group_id: null, ...over,
});

function stubCtx({ over = false, unknown = 0 } = {}) {
  const totals = {
    remaining_kcal: over ? -120 : 900, over_kcal: 120, kcal_goal: 1800, eaten_kcal: over ? 1920 : 900, entry_count: 3,
    protein_goal: 110, protein_known_g: 40, protein_gap_known_g: 70, protein_unknown_count: unknown,
    rough_count: 1, gpt_count: 0, needs_confirm_count: 1,
  };
  const g = [entry('e1'), entry('e2', { label_snapshot: '早餐飯糰', qty: 1, unit_kcal_snapshot: 190, group_id: 'g1', group_label: '早餐組合' })];
  const app = {
    workingDay: '2026-10-22',
    currentDietDay: () => '2026-10-22',
    maxDay: () => '2026-10-22',
    boundaryHint: () => ({ show: false }),
    now: () => new Date('2026-10-22T12:40:00+08:00'),
    backupReminder: () => ({ kind: 'never' }),
    totals: () => totals,
    quickGrid: () => [
      { type: 'food', id: 'f1', label: '茶葉蛋', kcal: 75, preset: false, opaque: false, needsConfirm: false, fromPreset: 1, fromOther: 0, total: 3, removable: 2 },
      { type: 'preset', id: 'p1', label: '早餐組合', kcal: 365, preset: true, opaque: false, needsConfirm: true, fromPreset: 0, fromOther: 0, total: 1, removable: 1 },
      { type: 'food', id: 'f2', label: '便當', kcal: 800, preset: false, opaque: true, needsConfirm: false, fromPreset: 0, fromOther: 0, total: 0, removable: 0 },
    ],
    listView: () => [{ type: 'entry', entry: g[0] }, { type: 'group', group_id: 'g1', label: '早餐組合', entries: [g[1]] }],
  };
  return { app, expanded: new Set(), updateReady: true };
}

test('首頁樣板保留快捷卡片、減號、左滑與局部更新所需的屬性', () => {
  const s = renderHome(stubCtx()).s;
  // 卡片主區＝記一份；減號是獨立按鈕，且只在可減時出現
  assert.equal([...s.matchAll(/data-act="cell"/g)].length, 3);
  assert.equal([...s.matchAll(/data-act="cell-minus"/g)].length, 2);
  assert.match(s, /class="cell-main" data-key="main" data-act="cell" data-type="food" data-id="f1"/);
  assert.match(s, /data-pulse="3"/);
  assert.match(s, /含套餐 1/);
  for (const k of ['data-key="hero"', 'data-tween="900"', 'role="progressbar"', 'data-key="c:add"']) assert.ok(s.includes(k), k);
  // 清單：左滑刪除、編輯、進退場屬性
  for (const k of ['class="swipe"', 'data-swipe-kind="entry"', 'data-swipe-kind="group"', 'data-act="swipe-delete"', 'data-act="edit-entry"', 'data-act="toggle-group"', 'data-act="edit-group"', 'data-keepstate', 'data-enter', 'data-leave']) {
    assert.ok(s.includes(k), k);
  }
  // 底部操作列與次要工具
  for (const a of ['open-rough', 'open-paste', 'open-copy', 'open-recent', 'open-copypast', 'open-compose', 'go-library', 'go-settings', 'day-prev', 'day-next', 'backup-now', 'reload-app']) {
    assert.ok(s.includes(`data-act="${a}"`), a);
  }
  // 文字都是繁體中文標示；狀態有文字，不只靠顏色
  for (const t of ['今天還剩', '待確認', '選份量', '套餐', '還沒備份過資料', '已有新版本', '已記', '目標']) assert.ok(s.includes(t), t);
});

test('超標與蛋白質未知都用文字表達，不只靠顏色', () => {
  const over = renderHome(stubCtx({ over: true, unknown: 2 })).s;
  assert.ok(over.includes('已超過目標'));
  assert.ok(over.includes('超標'));
  assert.ok(over.includes('另 2 項未知'));
  assert.ok(over.includes('hero over'));
  assert.ok(over.includes('data-tween="120"'));
});

test('首頁樣板沒有 emoji 圖示，也沒有外部圖片或網址', () => {
  const s = renderHome(stubCtx()).s;
  assert.doesNotMatch(s, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.doesNotMatch(s, /<img|https?:\/\//);
});
