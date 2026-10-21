import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateLibraryDoc } from '../app/js/core/validate.js';
import { loadSample } from './helpers.js';

const check = (mutate) => {
  const { doc } = loadSample();
  mutate(doc);
  return validateLibraryDoc(doc);
};
const hasError = (r, text) => r.errors.some((e) => e.includes(text));

test('範例食物庫通過檢查', () => {
  const r = check(() => {});
  assert.deepEqual(r.errors, []);
});

test('省略 protein_book 會擋下；寫 null 可以；寫 0 會提醒', () => {
  assert.ok(hasError(check((d) => { delete d.foods[1].protein_book; }), 'protein_book'));
  assert.deepEqual(check((d) => { d.foods[1].protein_book = null; }).errors, []);
  const zero = check((d) => { d.foods[1].protein_book = 0; });
  assert.deepEqual(zero.errors, []);
  assert.equal(zero.warnings.length, 1);
});

test('套餐不可另存總熱量或蛋白質', () => {
  assert.ok(hasError(check((d) => { d.presets[0].kcal_min = 605; }), 'kcal_min'));
  assert.ok(hasError(check((d) => { d.presets[0].protein = 62; }), 'protein'));
});

test('套餐引用不存在的食物、份量 0 會擋下', () => {
  assert.ok(hasError(check((d) => { d.presets[0].items[0].food_id = 'ghost'; }), 'ghost'));
  assert.ok(hasError(check((d) => { d.presets[0].items[0].qty = 0; }), '份量'));
});

test('重複 id、食物與套餐同 id 會擋下', () => {
  assert.ok(hasError(check((d) => { d.foods[1].id = 't_latte'; }), '重複'));
  assert.ok(hasError(check((d) => { d.presets[0].id = 't_egg'; }), '相同 id'));
});

test('熱量範圍順序錯、整餐模板缺偏少／偏多會擋下', () => {
  assert.ok(hasError(check((d) => { d.foods[4].kcal_low = 700; }), 'kcal_low'));
  assert.ok(hasError(check((d) => { d.foods[4].kcal_high = null; }), '整餐模板'));
  assert.ok(hasError(check((d) => { d.foods[0].kcal_book = -1; }), 'kcal_book'));
});

test('來源類型只接受五種', () => {
  assert.ok(hasError(check((d) => { d.foods[0].source_type = 'guess'; }), 'source_type'));
});

test('快捷格：最多 12 格、不可重複、引用必須存在', () => {
  const thirteen = check((d) => {
    d.settings.quick_slots = Array.from({ length: 13 }, (_, i) => ({ type: 'food', id: i ? `x${i}` : 't_egg' }));
  });
  assert.ok(hasError(thirteen, '最多 12 格'));
  assert.ok(hasError(check((d) => { d.settings.quick_slots.push({ type: 'food', id: 't_egg' }); }), '重複'));
  assert.ok(hasError(check((d) => { d.settings.quick_slots[0] = { type: 'preset', id: 't_latte' }; }), '找不到'));
});

test('換日時間與目標值範圍', () => {
  assert.ok(hasError(check((d) => { d.settings.day_boundary_hour = 13; }), 'day_boundary_hour'));
  assert.ok(hasError(check((d) => { d.settings.kcal_goal_default = 0; }), 'kcal_goal_default'));
});

test('較新版本或格式不符的檔案會拒絕', () => {
  assert.ok(hasError(check((d) => { d.schema_version = 2; }), '較新版本'));
  assert.ok(hasError(check((d) => { d.format = 'other'; }), 'format'));
  assert.ok(hasError(validateLibraryDoc(null), 'JSON'));
});
