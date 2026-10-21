import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSummary, REPLY_FORMAT_LINE } from '../app/js/core/gptSummary.js';
import { parseGptText } from '../app/js/core/gptParse.js';
import { entriesFromPreset, entryFromFood, roughEntry } from '../app/js/core/ledger.js';
import { dayTotals } from '../app/js/core/summary.js';
import { idSeq, loadSample } from './helpers.js';

const DAY = '2026-10-21';
const day = { diet_day: DAY, kcal_goal: 1800, protein_goal: 110 };

function build(question = 'dinner', extra = '') {
  const { foods, presets } = loadSample();
  const at = (h, m) => new Date(2026, 9, 21, h, m);
  const lunch = entriesFromPreset(presets.get('t_lunch'), foods, { dietDay: DAY, now: at(12, 40), makeId: idSeq('p') }).entries;
  const latte = entryFromFood(foods.get('t_latte'), { dietDay: DAY, now: at(15, 10) });
  const rough = roughEntry({ dietDay: DAY, kcal: 355, kcalLow: 320, kcalHigh: 390, level: 'normal', name: '金川燒', note: '下午點心', now: at(16, 30) });
  const entries = [rough, ...lunch, latte];
  const totals = dayTotals(entries, day);
  return { text: buildSummary({ now: at(18, 40), dietDay: DAY, totals, entries, question, extra }), totals };
}

test('摘要含飲食日、現在時間、目標、已記、剩餘、蛋白質與未知數', () => {
  const { text, totals } = build();
  assert.match(text, /飲食日 10\/21（三）｜現在 18:40/);
  assert.match(text, /目標 1,800 kcal｜已記 1,340 kcal｜剩餘 460 kcal/);
  assert.equal(totals.eaten_kcal, 1340);
  assert.match(text, /蛋白質 已記錄估算約 62 g／目標 110 g｜另有 2 項蛋白質未知（未計入）/);
});

test('摘要明示 App 是唯一帳本、不要另立帳本', () => {
  const { text } = build();
  assert.match(text, /唯一帳本/);
  assert.match(text, /不要在 GPT 另立帳本/);
  assert.match(text, /App 不會因此自動修改/);
});

test('逐筆列出完整名稱、份量、熱量、蛋白質、來源、群組與備註；時間由早到晚', () => {
  const { text } = build();
  const lines = text.split('\n');
  const idx = (s) => lines.findIndex((l) => l.includes(s));
  assert.ok(idx('測試餐盒') < idx('測試拿鐵') && idx('測試拿鐵') < idx('金川燒'));
  assert.match(text, /12:40 測試餐盒 ×1｜470 kcal｜蛋白質 42 g｜舊估算・待確認｜〔測試午餐〕/);
  assert.match(text, /12:40 測試蛋 ×2｜150 kcal｜蛋白質 12 g/);
  assert.match(text, /15:10 測試拿鐵（蛋白質未知） ×1｜245 kcal｜蛋白質 未知｜舊估算・待確認/);
  assert.match(text, /16:30 金川燒 ×1（一般）｜355 kcal（範圍 320–390）｜蛋白質 未知｜粗估｜備註：下午點心/);
});

test('三種提問', () => {
  assert.match(build('dinner', '想在全家吃').text, /問題：晚餐建議.*\n補充：想在全家吃/);
  assert.match(build('estimate', '起司蛋餅加豆漿紅茶').text, /問題：幫我估算這餐：起司蛋餅加豆漿紅茶/);
  assert.match(build('free', '今天蛋白質夠嗎').text, /問題：今天蛋白質夠嗎/);
  assert.match(build('estimate').text, /請在這裡描述餐點/);
});

test('回覆格式：候選不要加 @扣打；格式範例行貼回 App 不會被當成紀錄', () => {
  const { text } = build();
  assert.match(text, /候選方案，請用普通文字列出估算，不要加 @扣打/);
  assert.ok(text.includes(REPLY_FORMAT_LINE));
  const parsed = parseGptText(text);
  assert.equal(parsed.items.length, 0, '把整段摘要貼回 App，不能產生任何待記入項目');
});

test('超標顯示「超過 N kcal」，不是負數', () => {
  const big = [roughEntry({ dietDay: DAY, kcal: 1920 })];
  const totals = dayTotals(big, day);
  const text = buildSummary({ now: new Date(2026, 9, 21, 20, 0), dietDay: DAY, totals, entries: big });
  assert.match(text, /超過 120 kcal/);
  assert.doesNotMatch(text, /剩餘 -/);
});

test('空的一天、查看其他日', () => {
  const totals = dayTotals([], day);
  const text = buildSummary({ now: new Date(2026, 9, 21, 9, 0), dietDay: DAY, totals, entries: [], isCurrentDay: false });
  assert.match(text, /今日還沒有任何紀錄/);
  assert.match(text, /補記／查看，不是目前的飲食日/);
});
