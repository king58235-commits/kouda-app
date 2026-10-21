import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addSlot, foodFromForm, foodFromGptItem, foodReferences, moveSlot, presetFromForm, removeSlot,
} from '../app/js/core/library.js';
import { parseGptText } from '../app/js/core/gptParse.js';
import { validateFood } from '../app/js/core/validate.js';
import { loadSample } from './helpers.js';

const form = (over = {}) => ({
  short_label: '新食物', full_name: '', kind: 'single', unit: '', kcal_book: '300', protein_book: '',
  source_type: 'rough', source_note: '', needs_confirm: false, ...over,
});

test('表單 → 食物：蛋白質留空 = 未知（null）；沒填完整名稱用短名', () => {
  const { food, errors } = foodFromForm(form());
  assert.deepEqual(errors, []);
  assert.equal(food.protein_book, null);
  assert.equal(food.full_name, '新食物');
  assert.equal(food.unit, '份');
  assert.equal(food.kcal_book, 300);
  assert.match(food.id, /^f_/);
});

test('表單檢查：缺熱量、亂填數字、整餐模板缺偏少／偏多都會有錯誤', () => {
  assert.ok(foodFromForm(form({ kcal_book: '' })).errors.length > 0);
  assert.ok(foodFromForm(form({ kcal_book: 'abc' })).errors.length > 0);
  assert.ok(foodFromForm(form({ short_label: '' })).errors.length > 0);
  assert.ok(foodFromForm(form({ kind: 'opaque' })).errors.length > 0);
  const ok = foodFromForm(form({ kind: 'opaque', kcal_book: '600', kcal_low: '500', kcal_high: '700' }));
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.food.kcal_low, 500);
});

test('編輯既有食物保留 id 與封存狀態', () => {
  const { foods } = loadSample();
  const old = { ...foods.get('t_egg'), archived: true };
  const { food } = foodFromForm(form({ short_label: '蛋', kcal_book: '80', protein_book: '6' }), old);
  assert.equal(food.id, 't_egg');
  assert.equal(food.archived, true);
  assert.equal(food.protein_book, 6);
});

test('套餐表單：引用不存在的食物、份量 0 會有錯誤', () => {
  const { foods } = loadSample();
  const good = presetFromForm({ label: '早餐', items: [{ food_id: 't_egg', qty: '2' }] }, null, foods);
  assert.deepEqual(good.errors, []);
  assert.equal(good.preset.items[0].qty, 2);
  assert.ok(presetFromForm({ label: '壞', items: [{ food_id: 'ghost', qty: 1 }] }, null, foods).errors.length > 0);
  assert.ok(presetFromForm({ label: '壞', items: [{ food_id: 't_egg', qty: 0 }] }, null, foods).errors.length > 0);
  assert.ok(presetFromForm({ label: '空', items: [] }, null, foods).errors.length > 0);
});

test('封存前能查到被哪些套餐與快捷格引用', () => {
  const { presets, doc } = loadSample();
  const refs = foodReferences('t_egg', presets, doc.settings);
  assert.deepEqual(refs.presets.map((p) => p.id), ['t_lunch']);
  assert.equal(refs.inQuickSlots, true);
  assert.deepEqual(foodReferences('t_soy', presets, doc.settings).inQuickSlots, false);
});

test('快捷格：新增、重複、已滿、移除、移動', () => {
  let slots = [{ type: 'food', id: 'a' }, { type: 'preset', id: 'p' }];
  assert.throws(() => addSlot(slots, { type: 'food', id: 'a' }), /已在快捷格/);
  slots = addSlot(slots, { type: 'food', id: 'b' });
  assert.equal(slots.length, 3);
  const full = Array.from({ length: 12 }, (_, i) => ({ type: 'food', id: `x${i}` }));
  assert.throws(() => addSlot(full, { type: 'food', id: 'y' }), /已滿/);
  assert.deepEqual(removeSlot(slots, { type: 'food', id: 'a' }).map((s) => s.id), ['p', 'b']);
  assert.deepEqual(moveSlot(slots, 2, -1).map((s) => s.id), ['a', 'b', 'p']);
  assert.deepEqual(moveSlot(slots, 0, -1), slots);
  assert.deepEqual(moveSlot(slots, 2, 1), slots);
});

test('GPT 項目存成食物：有範圍 → 整餐模板；單一數字 → 單品；來源是 GPT 估算並保留原文', () => {
  const ranged = parseGptText('@扣打 起司蛋餅加豆漿紅茶｜熱量 600-740 kcal｜蛋白質 23 g').items[0];
  const f1 = foodFromGptItem(ranged, { id: 'g1', now: new Date(2026, 9, 21) });
  assert.equal(f1.kind, 'opaque');
  assert.deepEqual([f1.kcal_low, f1.kcal_book, f1.kcal_high, f1.protein_book], [600, 670, 740, 23]);
  assert.equal(f1.source_type, 'gpt_estimate');
  assert.match(f1.source_note, /@扣打 起司蛋餅/);
  assert.deepEqual(validateFood(f1).errors, []);
  assert.ok([...f1.short_label].length <= 5);

  const single = parseGptText('@扣打 鮪魚吐司｜熱量 320 kcal｜蛋白質 未知').items[0];
  const f2 = foodFromGptItem(single, { id: 'g2' });
  assert.equal(f2.kind, 'single');
  assert.equal(f2.protein_book, null);
  assert.deepEqual(validateFood(f2).errors, []);
});
