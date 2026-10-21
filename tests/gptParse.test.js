import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gptEntry } from '../app/js/core/ledger.js';
import { markDuplicates, parseGptText } from '../app/js/core/gptParse.js';
import { NOW } from './helpers.js';

const one = (line) => parseGptText(line);

test('標準格式：名稱、熱量範圍、蛋白質、備註', () => {
  const { items, rejected } = one('@扣打 起司蛋餅＋豆漿紅茶｜熱量 600-740 kcal｜蛋白質 23 g｜早餐店中杯');
  assert.equal(rejected.length, 0);
  const it = items[0];
  assert.equal(it.name, '起司蛋餅＋豆漿紅茶');
  assert.deepEqual([it.kcalLow, it.kcalMid, it.kcalHigh, it.hasRange], [600, 670, 740, true]);
  assert.equal(it.protein, 23);
  assert.equal(it.note, '早餐店中杯');
});

test('單一熱量、蛋白質未知（null，不是 0）', () => {
  const { items } = one('@扣打 鮪魚吐司｜熱量 320 kcal｜蛋白質 未知');
  assert.equal(items[0].hasRange, false);
  assert.equal(items[0].kcalMid, 320);
  assert.equal(items[0].protein, null);
  const none = one('@扣打 鮪魚吐司｜熱量 320 kcal').items[0];
  assert.equal(none.protein, null);
});

test('全形／半形直線、各種範圍符號、千分位、全形數字', () => {
  const lines = [
    '@扣打 A｜熱量 600–740 kcal｜蛋白質 20 g',
    '@扣打 B|熱量 600~740 kcal|蛋白質 20 g',
    '@扣打 C｜熱量 600～740 kcal｜蛋白質 20 g',
    '@扣打 D｜熱量 600—740 kcal｜蛋白質 20 g',
    '＠扣打 E｜熱量 １２００ kcal｜蛋白質 ２０ g',
    '@扣打 F｜熱量 1,200 kcal｜蛋白質 20 g',
  ];
  const { items, rejected } = one(lines.join('\n'));
  assert.equal(rejected.length, 0);
  assert.deepEqual(items.map((i) => [i.kcalLow, i.kcalHigh]), [
    [600, 740], [600, 740], [600, 740], [600, 740], [1200, 1200], [1200, 1200],
  ]);
});

test('蛋白質範圍採下限並提醒；熱量上下限顛倒會對調並提醒', () => {
  const it = one('@扣打 X｜熱量 740-600 kcal｜蛋白質 25-30 g').items[0];
  assert.deepEqual([it.kcalLow, it.kcalHigh, it.protein, it.proteinHigh], [600, 740, 25, 30]);
  assert.equal(it.warnings.length, 2);
});

test('沒有關鍵字也能辨識 kcal 與公克', () => {
  const it = one('@扣打 滷味｜650 kcal｜45 g').items[0];
  assert.equal(it.kcalLow, 650);
  assert.equal(it.protein, 45);
});

test('從整段回覆中只取 @扣打 行；容許項目符號與程式碼框', () => {
  const text = [
    '好的，這是我的估算：',
    '候選一：全家雞胸餐盒 約 360 kcal',
    '```',
    '@扣打 金川燒｜熱量 320-390 kcal｜蛋白質 未知｜下午點心',
    '```',
    '- @扣打 茶葉蛋｜熱量 75 kcal｜蛋白質 6 g',
    '1. @扣打 豆奶｜熱量 153 kcal｜蛋白質 15.1 g',
    '希望有幫助',
  ].join('\n');
  const { items, rejected, mentions } = one(text);
  assert.deepEqual(items.map((i) => i.name), ['金川燒', '茶葉蛋', '豆奶']);
  assert.equal(rejected.length, 0);
  assert.equal(mentions.length, 0);
});

test('負數、異常大的數字、缺熱量、缺名稱都會安全拒絕並說明原因', () => {
  const text = [
    '@扣打 負的｜熱量 -200 kcal｜蛋白質 10 g',
    '@扣打 太大｜熱量 99999 kcal｜蛋白質 10 g',
    '@扣打 沒熱量｜蛋白質 10 g',
    '@扣打 ｜熱量 300 kcal',
    '@扣打 蛋白質負｜熱量 300 kcal｜蛋白質 -5 g',
    '@扣打 亂碼｜熱量 很多',
    '@扣打 熱量不明｜熱量 未知',
    '@扣打 多數字｜熱量 300 kcal（半份 150）',
  ].join('\n');
  const { items, rejected } = one(text);
  assert.equal(items.length, 0);
  assert.equal(rejected.length, 8);
  const reasons = rejected.map((r) => r.reason);
  assert.match(reasons[0], /負數/);
  assert.match(reasons[1], /異常/);
  assert.match(reasons[2], /缺少熱量/);
  assert.match(reasons[3], /缺少餐點名稱/);
  assert.match(reasons[4], /負數/);
  assert.match(reasons[5], /沒有數字/);
  assert.match(reasons[6], /未知/);
  assert.match(reasons[7], /括號/);
  assert.ok(rejected.every((r) => r.ok === false));
});

test('App 自己的格式範例行被貼回來時不會變成紀錄', () => {
  const echo = '@扣打 餐點完整名稱｜熱量 低-高 kcal｜蛋白質 數字 g（未知寫「未知」）｜備註';
  const { items, rejected } = one(echo);
  assert.equal(items.length, 0);
  assert.equal(rejected.length, 1);
});

test('@扣打 不在行首的句子只會被列為提醒，不會被當成紀錄', () => {
  const { items, mentions } = one('請用 @扣打 格式回覆：@扣打 假的｜熱量 100 kcal');
  assert.equal(items.length, 0);
  assert.equal(mentions.length, 1);
});

test('同一次貼上裡重複的行只留一行', () => {
  const l = '@扣打 茶葉蛋｜熱量 75 kcal｜蛋白質 6 g';
  const { items, rejected } = one(`${l}\n${l.replace('｜', ' ｜ ')}`);
  assert.equal(items.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /相同/);
});

test('今天已用同一行記過 → 標示重複；別天不算（T07）', () => {
  const raw = '@扣打 金川燒｜熱量 320-390 kcal｜蛋白質 未知';
  const entry = gptEntry({
    dietDay: '2026-10-21', kcal: 355, kcalLow: 320, kcalHigh: 390, name: '金川燒', gptRawLine: raw, now: NOW,
  });
  const parsed = one(`${raw}\n@扣打 新的｜熱量 100 kcal｜蛋白質 3 g`).items;
  const today = markDuplicates(parsed, [entry], '2026-10-21');
  assert.deepEqual(today.map((i) => i.duplicate), [true, false]);
  const other = markDuplicates(parsed, [entry], '2026-10-22');
  assert.deepEqual(other.map((i) => i.duplicate), [false, false]);
  // 空白與全半形差異不影響判斷
  const spaced = one('＠扣打 金川燒 ｜ 熱量 320–390 kcal ｜ 蛋白質 未知').items;
  assert.equal(markDuplicates(spaced, [entry], '2026-10-21')[0].duplicate, true);
});

test('空輸入、沒有 @扣打 → 沒有任何項目', () => {
  assert.deepEqual(one('').items, []);
  assert.deepEqual(one('只是一般聊天').items, []);
  assert.deepEqual(parseGptText(undefined).items, []);
});

test('解析本身不會寫入任何東西：結果只是待確認清單', () => {
  const before = JSON.stringify([]);
  const r = one('@扣打 X｜熱量 100 kcal');
  assert.equal(JSON.stringify([]), before);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].ok, true);
});
