import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  entriesFromPreset, entryFromFood, moveGroup, removeEntry, removeGroup,
  roughEntry, withDietDay, withLevel, withQty,
} from '../app/js/core/ledger.js';
import { dayTotals, presetTotals } from '../app/js/core/summary.js';
import { idSeq, loadSample, NOW } from './helpers.js';

const DAY = '2026-10-21';
const day = { diet_day: DAY, kcal_goal: 1800, protein_goal: 110 };

test('單品紀錄複製當下數值與來源', () => {
  const { foods } = loadSample();
  const e = entryFromFood(foods.get('t_box'), { dietDay: DAY, id: 'e1', now: NOW });
  assert.equal(e.unit_kcal_snapshot, 470);
  assert.equal(e.unit_protein_snapshot, 42);
  assert.equal(e.name_snapshot, '測試餐盒');
  assert.equal(e.source_type_snapshot, 'legacy_estimate');
  assert.equal(e.needs_confirm_snapshot, true);
  assert.equal(e.level, null);
  assert.equal(e.origin, 'food');
});

test('蛋白質未知的食物，紀錄也存 null，不變成 0', () => {
  const { foods } = loadSample();
  const e = entryFromFood(foods.get('t_latte'), { dietDay: DAY, now: NOW });
  assert.equal(e.unit_protein_snapshot, null);
});

test('改食物庫不會改到已記的紀錄（T09）', () => {
  const { foods } = loadSample();
  const egg = foods.get('t_egg');
  const before = entryFromFood(egg, { dietDay: DAY, now: NOW });
  egg.kcal_book = 999;
  egg.protein_book = 99;
  assert.equal(before.unit_kcal_snapshot, 75);
  assert.equal(before.unit_protein_snapshot, 6);
  const after = entryFromFood(egg, { dietDay: DAY, now: NOW });
  assert.equal(after.unit_kcal_snapshot, 999);
});

test('整餐模板依級別取熱量，預設一般', () => {
  const { foods } = loadSample();
  const meal = foods.get('t_meal');
  assert.equal(entryFromFood(meal, { dietDay: DAY, now: NOW }).unit_kcal_snapshot, 620);
  assert.equal(entryFromFood(meal, { dietDay: DAY, level: 'low', now: NOW }).unit_kcal_snapshot, 490);
  const high = entryFromFood(meal, { dietDay: DAY, level: 'high', now: NOW });
  assert.equal(high.unit_kcal_snapshot, 760);
  assert.equal(high.level, 'high');
  assert.equal(withLevel(high, 'low', NOW).unit_kcal_snapshot, 490);
});

test('單品不能選級別；級別值不合法會拒絕', () => {
  const { foods } = loadSample();
  assert.throws(() => entryFromFood(foods.get('t_egg'), { dietDay: DAY, level: 'high' }));
  assert.throws(() => entryFromFood(foods.get('t_meal'), { dietDay: DAY, level: 'huge' }));
  const egg = entryFromFood(foods.get('t_egg'), { dietDay: DAY, now: NOW });
  assert.throws(() => withLevel(egg, 'low'));
});

test('份量必須大於 0；飲食日格式必須正確', () => {
  const { foods } = loadSample();
  const egg = foods.get('t_egg');
  assert.throws(() => entryFromFood(egg, { dietDay: DAY, qty: 0 }));
  assert.throws(() => entryFromFood(egg, { dietDay: DAY, qty: -1 }));
  assert.throws(() => entryFromFood(egg, { dietDay: DAY, qty: Number.NaN }));
  assert.throws(() => entryFromFood(egg, { dietDay: '2026/10/21' }));
  const e = entryFromFood(egg, { dietDay: DAY, now: NOW });
  assert.throws(() => withQty(e, 0));
});

test('套餐展開成多筆、共用群組，總數等於單品相加', () => {
  const { foods, presets } = loadSample();
  const preset = presets.get('t_lunch');
  const { entries, warnings } = entriesFromPreset(preset, foods, { dietDay: DAY, now: NOW, makeId: idSeq('p') });
  assert.equal(entries.length, 3);
  assert.deepEqual(warnings, []);
  const gid = entries[0].group_id;
  assert.ok(entries.every((e) => e.group_id === gid && e.group_label === '測試午餐' && e.origin === 'preset'));
  assert.equal(new Set(entries.map((e) => e.id)).size, 3);
  assert.equal(entries.find((e) => e.food_id === 't_egg').qty, 2);

  const t = dayTotals(entries, day);
  assert.equal(t.eaten_kcal, 470 + 75 * 2 + 120);
  assert.equal(t.protein_known_g, 42 + 6 * 2 + 8);
  assert.deepEqual(presetTotals(preset, foods), { kcal: 740, protein_known_g: 62, protein_unknown_count: 0 });
});

test('套餐展開的順序與套餐裡一致，時間戳差 1 毫秒', () => {
  const { foods, presets } = loadSample();
  const { entries } = entriesFromPreset(presets.get('t_lunch'), foods, { dietDay: DAY, now: NOW, makeId: idSeq('p') });
  assert.deepEqual(entries.map((e) => e.food_id), ['t_box', 't_egg', 't_soy']);
  const sorted = [...entries].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  assert.deepEqual(sorted.map((e) => e.food_id), ['t_box', 't_egg', 't_soy']);
});

test('套餐不會被重複計算（T02）：改一顆蛋、整組撤銷', () => {
  const { foods, presets } = loadSample();
  const { entries } = entriesFromPreset(presets.get('t_lunch'), foods, { dietDay: DAY, now: NOW, makeId: idSeq('p') });
  const latte = entryFromFood(foods.get('t_latte'), { dietDay: DAY, id: 'solo', now: NOW });
  let all = [...entries, latte];
  assert.equal(dayTotals(all, day).eaten_kcal, 740 + 245);

  all = all.map((e) => (e.food_id === 't_egg' ? withQty(e, 1, NOW) : e));
  assert.equal(dayTotals(all, day).eaten_kcal, 740 - 75 + 245);

  all = removeGroup(all, entries[0].group_id);
  assert.deepEqual(all.map((e) => e.id), ['solo']);
  assert.equal(dayTotals(all, day).eaten_kcal, 245);
});

test('套餐引用不存在的食物會拒絕；引用封存食物會提醒', () => {
  const { foods } = loadSample();
  assert.throws(() => entriesFromPreset({ label: '壞', items: [{ food_id: 'nope', qty: 1 }] }, foods, { dietDay: DAY }));
  foods.get('t_egg').archived = true;
  const { warnings } = entriesFromPreset(
    { label: '有封存', items: [{ food_id: 't_egg', qty: 1 }] }, foods, { dietDay: DAY, now: NOW },
  );
  assert.equal(warnings.length, 1);
});

test('粗估只需要熱量；蛋白質未知；範圍外的值會拒絕（T03）', () => {
  const e = roughEntry({ dietDay: DAY, kcal: 800, now: NOW });
  assert.equal(e.unit_kcal_snapshot, 800);
  assert.equal(e.unit_protein_snapshot, null);
  assert.equal(e.source_type_snapshot, 'rough');
  assert.equal(e.food_id, null);
  assert.equal(e.name_snapshot, '外食粗估');
  const t = dayTotals([e], day);
  assert.equal(t.protein_unknown_count, 1);
  assert.equal(t.rough_count, 1);

  assert.throws(() => roughEntry({ dietDay: DAY, kcal: -5 }));
  assert.throws(() => roughEntry({ dietDay: DAY }));
  assert.throws(() => roughEntry({ dietDay: DAY, kcal: 900, kcalLow: 320, kcalHigh: 390 }));
  const ranged = roughEntry({ dietDay: DAY, kcal: 355, kcalLow: 320, kcalHigh: 390, level: 'normal', now: NOW });
  assert.equal(withLevel(ranged, 'high', NOW).unit_kcal_snapshot, 390);
});

test('移到前一天只改該筆（或該組）的飲食日', () => {
  const { foods, presets } = loadSample();
  const { entries } = entriesFromPreset(presets.get('t_lunch'), foods, { dietDay: DAY, now: NOW, makeId: idSeq('p') });
  const egg = entryFromFood(foods.get('t_egg'), { dietDay: DAY, id: 'solo', now: NOW });
  const moved = withDietDay(egg, '2026-10-20', NOW);
  assert.equal(moved.diet_day, '2026-10-20');
  assert.equal(moved.unit_kcal_snapshot, 75);

  const all = moveGroup([...entries, egg], entries[0].group_id, '2026-10-20', NOW);
  assert.equal(all.filter((e) => e.diet_day === '2026-10-20').length, 3);
  assert.equal(all.find((e) => e.id === 'solo').diet_day, DAY);
  assert.deepEqual(removeEntry(all, 'solo').map((e) => e.id).includes('solo'), false);
});
