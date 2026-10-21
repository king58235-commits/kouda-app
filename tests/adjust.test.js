// V1.1 快捷卡片的 ＋／−：UX01～UX08
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foodUsage, planDecrementFood, planDecrementPreset, presetUsage } from '../app/js/core/adjust.js';
import { entriesFromPreset, entryFromFood, gptEntry, roughEntry, withQty } from '../app/js/core/ledger.js';
import { KoudaApp } from '../app/js/state.js';
import { MemoryRepo } from './support/memory-repo.js';
import { idSeq, loadSample } from './helpers.js';

const DAY = '2026-10-21';

function clock(h = 12, mi = 40) {
  const c = { t: new Date(2026, 9, 21, h, mi, 0) };
  c.now = () => new Date(c.t);
  c.advance = (ms) => { c.t = new Date(c.t.getTime() + ms); };
  return c;
}

async function setup() {
  const clk = clock();
  const repo = new MemoryRepo();
  const app = new KoudaApp(repo, { now: clk.now });
  await app.init();
  const { doc } = loadSample();
  await app.applyImport(app.planImport(doc, 'library_only', { applySettings: true }));
  return { app, clk, repo };
}

const eaten = (app) => app.totals().eaten_kcal;
const cell = (app, id) => app.quickGrid().find((c) => c.id === id);
const eggs = (app) => app.entriesOf().filter((e) => e.food_id === 't_egg');

test('UX01 空白日點茶葉蛋 2 次：已記 150、剩 1650、蛋白質 12 g；卡片可減 2 份', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_egg');
  clk.advance(20_000);
  await app.quickAddFood('t_egg');
  const t = app.totals();
  assert.deepEqual([t.eaten_kcal, t.remaining_kcal, t.protein_known_g], [150, 1650, 12]);
  assert.deepEqual([cell(app, 't_egg').total, cell(app, 't_egg').removable], [2, 2]);
});

test('UX02 點減號：剩 75、剩 1725、蛋白質 6 g；不會觸發加一', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_egg');
  clk.advance(20_000);
  await app.quickAddFood('t_egg');
  const r = await app.decrementFood('t_egg');
  const t = app.totals();
  assert.deepEqual([t.eaten_kcal, t.remaining_kcal, t.protein_known_g], [75, 1725, 6]);
  assert.equal(eggs(app).length, 1);
  assert.match(r.message, /已減 測試蛋/);
  assert.ok(r.undoId);
});

test('UX03 再減一次：食物歸零、減號不再可用；再按也不會出現負數', async () => {
  const { app } = await setup();
  await app.quickAddFood('t_egg');
  await app.decrementFood('t_egg');
  assert.equal(eggs(app).length, 0);
  assert.equal(eaten(app), 0);
  assert.equal(cell(app, 't_egg').removable, 0);
  await assert.rejects(() => app.decrementFood('t_egg'), /沒有可以減少/);
  assert.equal(eaten(app), 0);
  assert.equal(app.totals().remaining_kcal, 1800);
});

test('UX04 減少後撤銷：恢復原本的紀錄（同 id、同快照），總數精確一致', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_egg');
  clk.advance(20_000);
  await app.quickAddFood('t_egg');
  await app.setEntryQty(eggs(app)[0].id, 2); // 合併成一筆 2 份也一樣
  const before = JSON.stringify(app.snapshot());
  const r = await app.decrementFood('t_egg');
  assert.notEqual(JSON.stringify(app.snapshot()), before);
  assert.equal(await app.undo(r.undoId), true);
  assert.equal(JSON.stringify(app.snapshot()), before);

  // 整筆刪除的情況也要精確還原
  const solo = await setup();
  await solo.app.quickAddFood('t_egg');
  const b2 = JSON.stringify(solo.app.snapshot());
  const r2 = await solo.app.decrementFood('t_egg');
  await solo.app.undo(r2.undoId);
  assert.equal(JSON.stringify(solo.app.snapshot()), b2);
});

test('UX05 獨立 2 顆蛋＋南加州午餐（含 2 顆蛋）：單品減號只減獨立的，套餐不變', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_egg');
  clk.advance(20_000);
  await app.quickAddFood('t_egg');
  clk.advance(20_000);
  await app.quickAddPreset('t_lunch');
  const c = cell(app, 't_egg');
  assert.deepEqual([c.total, c.removable, c.fromPreset, c.fromOther], [4, 2, 2, 0]);
  const groupBefore = JSON.stringify(app.entriesOf().filter((e) => e.group_id));

  await app.decrementFood('t_egg');
  await app.decrementFood('t_egg');
  assert.equal(JSON.stringify(app.entriesOf().filter((e) => e.group_id)), groupBefore, '套餐組成沒被動到');
  assert.equal(cell(app, 't_egg').removable, 0);
  assert.equal(cell(app, 't_egg').total, 2, '套餐裡的兩顆仍然算在今天吃的');
  await assert.rejects(() => app.decrementFood('t_egg'), /套餐裡的份數不能用這個減號改/);
  assert.equal(eaten(app), 740);
});

test('UX05b 只有套餐裡有這個食物：沒有可減的，不會誤刪套餐組成', async () => {
  const { app } = await setup();
  await app.quickAddPreset('t_lunch');
  assert.equal(cell(app, 't_egg').removable, 0);
  assert.equal(cell(app, 't_egg').total, 2);
  await assert.rejects(() => app.decrementFood('t_egg'));
  assert.equal(app.entriesOf().length, 3);
});

test('UX05c GPT／粗估的同名食物紀錄不算「可減」', async () => {
  const { app } = await setup();
  const parsed = app.parseGpt('@扣打 測試蛋加料｜熱量 100 kcal｜蛋白質 7 g');
  await app.commitGpt([{ ...parsed.items[0], saveAsQuick: true }]);
  const savedId = [...app.foods.values()].find((f) => f.full_name === '測試蛋加料').id;
  const c = app.quickGrid().find((x) => x.id === savedId) ?? { total: 1, removable: 0 };
  assert.equal(foodUsage([...app.db.entries.values()], savedId, app.workingDay).total, 1);
  assert.equal(foodUsage([...app.db.entries.values()], savedId, app.workingDay).removable, 0);
  assert.equal(c.removable, 0);
  await assert.rejects(() => app.decrementFood(savedId));
  assert.equal(app.entriesOf().length, 1);
});

test('UX06 南加州午餐記兩次、按套餐減號一次：只刪最近的一整組，另一組完整', async () => {
  const { app, clk } = await setup();
  await app.quickAddPreset('t_lunch');
  const firstGroup = app.listView().find((x) => x.type === 'group').group_id;
  clk.advance(60_000);
  await app.quickAddPreset('t_lunch');
  assert.equal(cell(app, 't_lunch').removable, 2);
  assert.equal(eaten(app), 1480);
  await app.decrementPreset('t_lunch');
  assert.equal(eaten(app), 740);
  const remaining = app.entriesOf();
  assert.equal(remaining.length, 3);
  assert.ok(remaining.every((e) => e.group_id === firstGroup));
  assert.equal(cell(app, 't_lunch').removable, 1);
  await app.decrementPreset('t_lunch');
  await assert.rejects(() => app.decrementPreset('t_lunch'));
  assert.equal(app.entriesOf().length, 0);
});

test('UX06b 套餐減號撤銷：整組回來，群組 id 與快照不變', async () => {
  const { app } = await setup();
  await app.quickAddPreset('t_lunch');
  const before = JSON.stringify(app.snapshot());
  const r = await app.decrementPreset('t_lunch');
  assert.equal(app.entriesOf().length, 0);
  await app.undo(r.undoId);
  assert.equal(JSON.stringify(app.snapshot()), before);
});

test('UX07 份量 0.5 的獨立紀錄按減號：整筆刪除，不會變負份量，也不誤刪另一筆', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_egg'); // 較舊的一筆，1 份
  clk.advance(20_000);
  await app.quickAddFood('t_egg');
  const newest = eggs(app).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  await app.setEntryQty(newest.id, 0.5);
  await app.decrementFood('t_egg');
  const left = eggs(app);
  assert.equal(left.length, 1);
  assert.equal(left[0].qty, 1);
  assert.ok(left.every((e) => e.qty > 0));
  assert.equal(eaten(app), 75);
});

test('減 1.5 份 → 剩 0.5 份（不是負數）；2 份 → 1 份', () => {
  const { foods } = loadSample();
  const egg = foods.get('t_egg');
  const e15 = withQty(entryFromFood(egg, { dietDay: DAY, id: 'a' }), 1.5);
  const plan = planDecrementFood([e15], 't_egg', DAY, new Date());
  assert.deepEqual([plan.action, plan.next.qty], ['update', 0.5]);
  const e2 = withQty(entryFromFood(egg, { dietDay: DAY, id: 'b' }), 2);
  assert.equal(planDecrementFood([e2], 't_egg', DAY, new Date()).next.qty, 1);
  assert.equal(planDecrementFood([], 't_egg', DAY, new Date()), null);
});

test('減號只看「目前這一天」，不會跨日刪除', async () => {
  const { app } = await setup();
  app.setWorkingDay('2026-10-20');
  await app.quickAddFood('t_egg');
  app.setWorkingDay('2026-10-21');
  assert.equal(cell(app, 't_egg').removable, 0);
  await assert.rejects(() => app.decrementFood('t_egg'));
  app.setWorkingDay('2026-10-20');
  assert.equal(eggs(app).length, 1);
  await app.decrementFood('t_egg');
  assert.equal(eggs(app).length, 0);
});

test('各種來源的判斷：只有 origin=food 且不在群組的才算可減', () => {
  const { foods, presets } = loadSample();
  const egg = foods.get('t_egg');
  const solo = entryFromFood(egg, { dietDay: DAY, id: 'solo' });
  const { entries: grp } = entriesFromPreset(presets.get('t_lunch'), foods, { dietDay: DAY, makeId: idSeq('g') });
  const gpt = gptEntry({ dietDay: DAY, kcal: 100, name: '蛋', foodId: 't_egg', gptRawLine: '@扣打 x' });
  const rough = roughEntry({ dietDay: DAY, kcal: 100, foodId: 't_egg' });
  const all = [solo, ...grp, gpt, rough];
  assert.deepEqual(foodUsage(all, 't_egg', DAY), { total: 1 + 2 + 1 + 1, removable: 1, fromPreset: 2, fromOther: 2 });
  assert.deepEqual(presetUsage(all, 't_lunch', DAY), { groups: 1 });
  assert.equal(planDecrementFood(all, 't_egg', DAY, new Date()).entry.id, 'solo');
  assert.equal(planDecrementPreset(all, 't_lunch', DAY).entries.length, 3);
});

test('UX08 快速連續加／減（同時觸發）依序處理，結果與帳本一致', async () => {
  const { app } = await setup();
  await Promise.all([
    app.quickAddFood('t_egg'), app.quickAddFood('t_egg'), app.quickAddFood('t_egg'),
    app.decrementFood('t_egg'), app.decrementFood('t_egg'),
    app.quickAddFood('t_egg'), app.decrementFood('t_egg'),
  ]);
  const total = eggs(app).reduce((a, e) => a + e.qty, 0);
  assert.equal(total, 3 - 2 + 1 - 1);
  assert.equal(eaten(app), total * 75);
  assert.ok(eggs(app).every((e) => e.qty > 0));
});

test('UX08 寫入失敗：減號、套餐減號都不會改到一半，之後恢復正常', async () => {
  const { app, repo } = await setup();
  await app.quickAddFood('t_egg');
  await app.quickAddPreset('t_lunch');
  const before = JSON.stringify(app.snapshot());
  repo.failNext = true;
  await assert.rejects(() => app.decrementFood('t_egg'), /模擬寫入失敗/);
  assert.equal(JSON.stringify(app.snapshot()), before);
  repo.failNext = true;
  await assert.rejects(() => app.decrementPreset('t_lunch'));
  assert.equal(JSON.stringify(app.snapshot()), before);
  await app.decrementFood('t_egg');
  assert.equal(eggs(app).filter((e) => !e.group_id).length, 0);
});

test('整餐模板（選份量）的減號：扣最近一筆，不分級別', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_meal', { level: 'low' });
  clk.advance(20_000);
  await app.quickAddFood('t_meal', { level: 'high' });
  await app.decrementFood('t_meal');
  const left = app.entriesOf().filter((e) => e.food_id === 't_meal');
  assert.equal(left.length, 1);
  assert.equal(left[0].level, 'low');
});
