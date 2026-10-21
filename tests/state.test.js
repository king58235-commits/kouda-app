// 以記憶體資料庫跑完整的操作流程：這就是工作單「完成標準」那幾條。
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseBackupText } from '../app/js/core/backup.js';
import { foodFromForm } from '../app/js/core/library.js';
import { KoudaApp } from '../app/js/state.js';
import { MemoryRepo } from './support/memory-repo.js';
import { loadSample } from './helpers.js';

// 固定時鐘，可往後撥
function clock(y, mo, d, h, mi = 0) {
  const c = { t: new Date(y, mo - 1, d, h, mi, 0) };
  c.now = () => new Date(c.t);
  c.set = (...a) => { c.t = new Date(...a); };
  c.advance = (ms) => { c.t = new Date(c.t.getTime() + ms); };
  return c;
}

async function setup({ clk = clock(2026, 10, 21, 12, 40), repo = new MemoryRepo(), importSample = true } = {}) {
  const app = new KoudaApp(repo, { now: clk.now });
  await app.init();
  if (importSample) {
    const { doc } = loadSample();
    const plan = app.planImport(doc, 'library_only', { applySettings: true });
    assert.equal(plan.ok, true, plan.errors.join('\n'));
    await app.applyImport(plan);
  }
  return { app, clk, repo };
}

const kcal = (app) => app.totals().eaten_kcal;

test('首次啟動：建立預設設定（1800／110／05:00），需要先匯入食物庫', async () => {
  const { app } = await setup({ importSample: false });
  assert.equal(app.needsSetup, true);
  assert.deepEqual(
    [app.settings.kcal_goal_default, app.settings.protein_goal_default, app.settings.day_boundary_hour],
    [1800, 110, 5],
  );
  assert.equal(app.totals().remaining_kcal, 1800);
  await app.startBlank();
  assert.equal(app.needsSetup, false);
});

test('老樣子×1＋茶葉蛋×2 → 已記 395、剩 1405、蛋白質已知 12 g＋1 項未知；撤銷後精確恢復', async () => {
  const { app, clk } = await setup();
  const r1 = await app.quickAddFood('t_latte');
  clk.advance(20_000); // 超過連點合併時間
  const r2 = await app.quickAddFood('t_egg');
  const r3 = await app.quickAddFood('t_egg');
  const t = app.totals();
  assert.equal(t.eaten_kcal, 245 + 150);
  assert.equal(t.remaining_kcal, 1405);
  assert.equal(t.protein_known_g, 12);
  assert.equal(t.protein_unknown_count, 1);
  assert.equal(r3.message, '已記 測試蛋 ×2');

  assert.equal(await app.undo(r3.undoId), true);
  assert.equal(kcal(app), 245 + 75);
  assert.equal(await app.undo(r3.undoId), false, '同一個撤銷不能再按一次');
  assert.ok(r1.undoId && r2.undoId);

  // 刪除 → 撤銷 → 精確恢復
  const entry = app.entriesOf()[0];
  const del = await app.removeEntry(entry.id);
  assert.equal(app.entriesOf().length, 1);
  await app.undo(del.undoId);
  assert.deepEqual(app.entriesOf().map((e) => e.id), app.entriesOf().map((e) => e.id));
  assert.equal(kcal(app), 245 + 75);
  assert.equal(app.entriesOf().find((e) => e.id === entry.id).qty, entry.qty);
});

test('連點同一個食物：8 秒內合併成同一筆加份數；隔太久或換食物就另起一筆', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_egg');
  clk.advance(3000);
  await app.quickAddFood('t_egg');
  clk.advance(3000);
  const r = await app.quickAddFood('t_egg');
  assert.equal(app.entriesOf().length, 1);
  assert.equal(app.entriesOf()[0].qty, 3);
  assert.equal(await app.undo(r.undoId), true);
  assert.equal(app.entriesOf()[0].qty, 2);

  clk.advance(30_000);
  await app.quickAddFood('t_egg');
  assert.equal(app.entriesOf().length, 2);
  clk.advance(1000);
  await app.quickAddFood('t_soy');
  clk.advance(1000);
  await app.quickAddFood('t_egg');
  assert.equal(app.entriesOf().length, 4);
});

test('連續快速呼叫（雙擊）依序處理，份數與總數正確', async () => {
  const { app } = await setup();
  await Promise.all([app.quickAddFood('t_egg'), app.quickAddFood('t_egg'), app.quickAddFood('t_egg')]);
  assert.equal(app.entriesOf().length, 1);
  assert.equal(app.entriesOf()[0].qty, 3);
  assert.equal(kcal(app), 225);
});

test('南加州午餐套餐：740 kcal／62 g → 只改一顆蛋 665／56 → 整組撤銷回到加入前', async () => {
  const { app } = await setup();
  await app.quickAddFood('t_latte');
  const before = kcal(app);
  const r = await app.quickAddPreset('t_lunch');
  let t = app.totals();
  assert.equal(t.eaten_kcal - before, 740);
  assert.equal(t.protein_known_g, 62);
  const group = app.listView().find((x) => x.type === 'group');
  assert.equal(group.entries.length, 3);
  assert.equal(group.label, '測試午餐');

  const eggs = group.entries.find((e) => e.food_id === 't_egg');
  await app.setEntryQty(eggs.id, 1);
  t = app.totals();
  assert.equal(t.eaten_kcal - before, 665);
  assert.equal(t.protein_known_g, 56);

  await app.removeGroup(group.group_id);
  assert.equal(kcal(app), before);
  assert.equal(app.entriesOf().length, 1);
  assert.ok(r.groupId);
});

test('刪除整組後可撤銷整組；套餐不會重複計算', async () => {
  const { app } = await setup();
  await app.quickAddPreset('t_lunch');
  const gid = app.listView()[0].group_id;
  const del = await app.removeGroup(gid);
  assert.equal(app.entriesOf().length, 0);
  await app.undo(del.undoId);
  assert.equal(app.entriesOf().length, 3);
  assert.equal(kcal(app), 740);
});

test('粗估 800 kcal、蛋白質不填：熱量正確扣除，蛋白質未知 +1，不變成 0', async () => {
  const { app } = await setup();
  const r = await app.addRough({ kcal: 800 });
  const t = app.totals();
  assert.equal(t.eaten_kcal, 800);
  assert.equal(t.remaining_kcal, 1000);
  assert.equal(t.protein_unknown_count, 1);
  assert.equal(t.protein_known_g, 0);
  assert.equal(t.rough_count, 1);
  assert.equal(r.quickSaved, false);
  await app.setEntryValues(app.entriesOf()[0].id, { name: '早餐店', kcal: 700, protein: 25 });
  assert.equal(kcal(app), 700);
  assert.equal(app.totals().protein_known_g, 25);
  assert.equal(app.entriesOf()[0].level, null);
});

test('粗估可存成快捷：建立食物並放進快捷格；快捷格滿了只存食物並提醒', async () => {
  const { app } = await setup();
  const r = await app.addRough({ kcal: 450, name: '雞肉飯', saveAsQuick: true });
  assert.equal(r.quickSaved, true);
  const slot = app.settings.quick_slots.at(-1);
  const food = app.foods.get(slot.id);
  assert.deepEqual([food.full_name, food.kcal_book, food.protein_book, food.source_type], ['雞肉飯', 450, null, 'rough']);
  assert.equal(app.entriesOf()[0].food_id, food.id);

  for (let i = app.settings.quick_slots.length; i < 12; i += 1) {
    await app.addRough({ kcal: 100, name: `x${i}`, saveAsQuick: true });
  }
  assert.equal(app.settings.quick_slots.length, 12);
  const full = await app.addRough({ kcal: 100, name: '放不下', saveAsQuick: true });
  assert.equal(full.quickFull, true);
  assert.equal(app.settings.quick_slots.length, 12);
  assert.ok([...app.foods.values()].some((f) => f.full_name === '放不下'));
});

test('整餐模板：選偏少／一般／偏多；改級別用當初的快照', async () => {
  const { app } = await setup();
  await app.quickAddFood('t_meal', { level: 'high' });
  const e = app.entriesOf()[0];
  assert.equal(e.unit_kcal_snapshot, 760);
  assert.equal(e.level, 'high');
  await app.setEntryLevel(e.id, 'low');
  assert.equal(kcal(app), 490);
});

test('貼多行 @扣打：先只是待確認清單，不按記入絕不改變總數；重複與壞資料不能亂記', async () => {
  const { app } = await setup();
  const text = [
    '推薦你吃這些：',
    '@扣打 金川燒｜熱量 320-390 kcal｜蛋白質 未知｜下午點心',
    '@扣打 茶葉蛋｜熱量 75 kcal｜蛋白質 6 g',
    '@扣打 壞掉｜熱量 -5 kcal',
  ].join('\n');
  const parsed = app.parseGpt(text);
  assert.equal(kcal(app), 0, '解析不會改變帳本');
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.rejected.length, 1);
  assert.equal(app.entriesOf().length, 0);

  // 只勾選金川燒
  const only = parsed.items.filter((i) => i.name === '金川燒');
  const r = await app.commitGpt(only);
  assert.equal(r.count, 1);
  assert.equal(kcal(app), 355);
  const e = app.entriesOf()[0];
  assert.deepEqual([e.origin, e.source_type_snapshot, e.level, e.unit_protein_snapshot], ['gpt', 'gpt_estimate', 'normal', null]);
  assert.match(e.gpt_raw_line, /^@扣打 金川燒/);

  // 同一個確認卡按兩次：不會重複記
  const again = await app.commitGpt(only);
  assert.equal(again.count, 0);
  assert.equal(app.entriesOf().length, 1);

  // 再貼一次同樣的內容：同一行被標成重複，預設不勾
  const second = app.parseGpt(text);
  assert.deepEqual(second.items.map((i) => [i.name, i.duplicate, i.selected]), [['金川燒', true, false], ['茶葉蛋', false, true]]);

  // 可以調整級別後再記入
  const pick = { ...second.items[1] };
  await app.commitGpt([pick]);
  assert.equal(kcal(app), 355 + 75);

  // 壞資料硬塞也會被擋下
  await assert.rejects(() => app.commitGpt([{ ...parsed.rejected[0], entryId: 'x' }]));
  assert.equal(kcal(app), 430);

  // 撤銷整批
  assert.equal(await app.undo(), true);
  assert.equal(kcal(app), 355);
});

test('GPT 項目可選偏多並存成快捷', async () => {
  const { app } = await setup();
  const parsed = app.parseGpt('@扣打 起司蛋餅加豆漿紅茶｜熱量 600-740 kcal｜蛋白質 23 g');
  const item = { ...parsed.items[0], level: 'high', saveAsQuick: true };
  const r = await app.commitGpt([item]);
  assert.equal(kcal(app), 740);
  assert.equal(app.entriesOf()[0].level, 'high');
  const food = app.foods.get(app.settings.quick_slots.at(-1).id);
  assert.deepEqual([food.kind, food.kcal_low, food.kcal_book, food.kcal_high, food.source_type], ['opaque', 600, 670, 740, 'gpt_estimate']);
  assert.equal(r.quickFull, false);
});

test('凌晨 01:30 記入前一個飲食日；改換日設定不搬動舊紀錄（T08）', async () => {
  const clk = clock(2026, 10, 22, 1, 30);
  const { app } = await setup({ clk });
  assert.equal(app.currentDietDay(), '2026-10-21');
  assert.deepEqual(
    [app.boundaryHint().show, app.boundaryHint().dietDay, app.boundaryHint().alternateDay],
    [true, '2026-10-21', '2026-10-22'],
  );
  await app.quickAddFood('t_latte');
  assert.equal(app.entriesOf('2026-10-21').length, 1);
  assert.equal(app.entriesOf('2026-10-22').length, 0);

  await app.saveSettings({ kcal_goal_default: 1800, protein_goal_default: 110, day_boundary_hour: 0 });
  assert.equal(app.currentDietDay(), '2026-10-22');
  assert.equal(app.entriesOf('2026-10-21').length, 1, '舊紀錄仍在原本那一天');
  assert.equal(app.entriesOf('2026-10-22').length, 0);
});

test('手動改到另一日：補記前一天、不能記到還沒到的日子', async () => {
  const clk = clock(2026, 10, 22, 1, 30);
  const { app } = await setup({ clk });
  app.setWorkingDay('2026-10-22'); // 日曆日期今天，換日前
  await app.quickAddFood('t_egg');
  assert.equal(app.entriesOf('2026-10-22').length, 1);
  app.shiftWorkingDay(-2);
  assert.equal(app.workingDay, '2026-10-20');
  await app.quickAddFood('t_soy');
  assert.equal(app.totals('2026-10-20').eaten_kcal, 120);
  assert.throws(() => app.setWorkingDay('2026-10-23'));
  app.setWorkingDay(app.currentDietDay());
  assert.equal(app.dayOverride, null);

  const e = app.entriesOf('2026-10-22')[0];
  await app.moveEntry(e.id, '2026-10-21');
  assert.equal(app.entriesOf('2026-10-21').length, 1);
  assert.equal(app.totals('2026-10-22').eaten_kcal, 0);
});

test('補記舊日的目標規則：該日若還沒有目標，用「當時的預設目標」建立並保存', async () => {
  const { app } = await setup();
  await app.saveSettings({ kcal_goal_default: 1700, protein_goal_default: 100, day_boundary_hour: 5 }, { applyToToday: false });
  app.setWorkingDay('2026-10-18');
  await app.quickAddFood('t_egg');
  assert.equal(app.dayRecord('2026-10-18').kcal_goal, 1700);
  await app.saveSettings({ kcal_goal_default: 2000, protein_goal_default: 120, day_boundary_hour: 5 }, { applyToToday: false });
  assert.equal(app.dayRecord('2026-10-18').kcal_goal, 1700, '之後改預設不回寫已建立的那一天');
});

test('改食物數值與每日預設目標，不改歷史快照（T09）', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_egg');
  await app.quickAddFood('t_box');
  const before = kcal(app);
  const goalBefore = app.dayRecord().kcal_goal;

  const { food } = foodFromForm({ ...app.foods.get('t_egg'), kcal_book: '999', protein_book: '1' }, app.foods.get('t_egg'), clk.now());
  await app.saveFood(food);
  await app.saveSettings({ kcal_goal_default: 1500, protein_goal_default: 90, day_boundary_hour: 5 }, { applyToToday: false });
  assert.equal(kcal(app), before);
  assert.equal(app.dayRecord().kcal_goal, goalBefore);
  assert.equal(app.totals().remaining_kcal, goalBefore - before);

  clk.advance(60_000);
  await app.quickAddFood('t_egg');
  assert.equal(kcal(app), before + 999);
});

test('改目標時可選擇是否套用到今天', async () => {
  const { app } = await setup();
  await app.quickAddFood('t_egg');
  await app.saveSettings({ kcal_goal_default: 1500, protein_goal_default: 90, day_boundary_hour: 5 }, { applyToToday: true });
  assert.equal(app.dayRecord().kcal_goal, 1500);
  assert.equal(app.totals().remaining_kcal, 1425);
  await assert.rejects(() => app.saveSettings({ kcal_goal_default: 0, protein_goal_default: 90, day_boundary_hour: 5 }));
  await assert.rejects(() => app.saveSettings({ kcal_goal_default: 1500, protein_goal_default: 90, day_boundary_hour: 99 }));
});

test('封存食物：快捷格自動移除、套餐仍保留引用並可查到', async () => {
  const { app } = await setup();
  const refs = app.foodReferences('t_egg');
  assert.deepEqual(refs.presets.map((p) => p.id), ['t_lunch']);
  assert.equal(refs.inQuickSlots, true);
  await app.archiveFood('t_egg', true);
  assert.equal(app.foods.get('t_egg').archived, true);
  assert.equal(app.settings.quick_slots.some((s) => s.id === 't_egg'), false);
  const r = await app.quickAddPreset('t_lunch');
  assert.equal(r.warnings.length, 1);
  assert.equal(app.entriesOf().length, 3, '套餐仍可使用，只是提醒含已封存食物');
  await app.archiveFood('t_egg', false);
  assert.equal(app.foods.get('t_egg').archived, false);
});

test('快捷格排列：加入、移動、移除；快捷格內容反映今日份數', async () => {
  const { app } = await setup();
  const grid = app.quickGrid();
  assert.deepEqual(grid.map((g) => g.label), ['測試拿鐵', '測試蛋', '測試午餐', '測試整餐']);
  await app.quickAddFood('t_egg');
  await app.quickAddPreset('t_lunch');
  const g2 = app.quickGrid();
  assert.equal(g2.find((g) => g.id === 't_egg').count, 3, '含套餐裡的 2 顆');
  assert.equal(g2.find((g) => g.id === 't_lunch').count, 1);
  assert.equal(g2.find((g) => g.id === 't_meal').opaque, true);
  await app.moveQuickSlot(0, 1);
  assert.equal(app.quickGrid()[0].label, '測試蛋');
  await app.addQuickSlot({ type: 'food', id: 't_soy' });
  assert.equal(app.quickGrid().length, 5);
  await app.removeQuickSlot({ type: 'food', id: 't_soy' });
  assert.equal(app.quickGrid().length, 4);
});

test('重新整理（重開 App）後資料仍在，數字相同', async () => {
  const { app, repo, clk } = await setup();
  await app.quickAddFood('t_latte');
  clk.advance(20_000);
  await app.quickAddPreset('t_lunch');
  const t = app.totals();
  const app2 = new KoudaApp(repo, { now: clk.now });
  await app2.init();
  assert.deepEqual(app2.totals(), t);
  assert.equal(app2.needsSetup, false);
  assert.equal(app2.foods.size, 5);
  assert.equal(app2.entriesOf().length, 4);
});

test('寫入失敗時，畫面用的資料不會被改一半', async () => {
  const { app, repo } = await setup();
  await app.quickAddFood('t_egg');
  const before = JSON.stringify(app.snapshot());
  repo.failNext = true;
  await assert.rejects(() => app.quickAddPreset('t_lunch'));
  assert.equal(JSON.stringify(app.snapshot()), before);
  const ok = await app.quickAddFood('t_soy');
  assert.ok(ok.undoId);
});

test('匯出 → 清空 → 完整還原：數字與套餐一致；同一份備份取代兩次不倍增（T10）', async () => {
  const { app, repo, clk } = await setup();
  await app.quickAddFood('t_latte');
  clk.advance(20_000);
  await app.quickAddPreset('t_lunch');
  await app.addRough({ kcal: 800 });
  const totals = app.totals();
  const { text } = await app.exportBackup('full');
  assert.ok(app.settings.last_export_at);

  const fresh = new KoudaApp(new MemoryRepo(), { now: clk.now });
  await fresh.init();
  assert.equal(fresh.needsSetup, true);
  const { doc, error } = parseBackupText(text);
  assert.equal(error, undefined);
  const plan = fresh.planImport(doc, 'replace_all');
  assert.equal(plan.ok, true, plan.errors.join('\n'));
  await fresh.applyImport(plan);
  assert.deepEqual(fresh.totals(), totals);
  assert.equal(fresh.needsSetup, false);
  assert.equal(fresh.settings.last_export_at, app.settings.last_export_at);

  await fresh.applyImport(fresh.planImport(doc, 'replace_all'));
  assert.deepEqual(fresh.totals(), totals);
  assert.equal(fresh.entriesOf().length, 5);

  // 就地清空 → 還原
  await repo.replaceAll({ foods: [], presets: [], days: [], entries: [], meta: [] });
  const reopened = new KoudaApp(repo, { now: clk.now });
  await reopened.init();
  assert.equal(reopened.entriesOf().length, 0);
  await reopened.applyImport(reopened.planImport(doc, 'replace_all'));
  assert.deepEqual(reopened.totals(), totals);
});

test('完整取代前會留一份匯入前快照，可以復原', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_egg');
  const { doc } = parseBackupText((await app.exportBackup('full')).text);
  clk.advance(20_000);
  await app.quickAddFood('t_soy');
  await app.applyImport(app.planImport(doc, 'replace_all'));
  assert.equal(app.entriesOf().length, 1);
  assert.equal(app.hasPreImportSnapshot, true);
  await app.restorePreImport();
  assert.equal(app.entriesOf().length, 2);
});

test('匯入失敗（檢查不過）不會動到任何資料', async () => {
  const { app } = await setup();
  await app.quickAddFood('t_egg');
  const before = JSON.stringify(app.snapshot());
  const { doc } = loadSample();
  const bad = structuredClone(doc);
  bad.presets[0].items[0].food_id = 'ghost';
  const plan = app.planImport(bad, 'library_only');
  assert.equal(plan.ok, false);
  await assert.rejects(() => app.applyImport(plan));
  assert.equal(JSON.stringify(app.snapshot()), before);
});

test('僅匯入食物庫：不動紀錄；只在勾選時套用設定', async () => {
  const { app } = await setup();
  await app.quickAddFood('t_egg');
  await app.saveSettings({ kcal_goal_default: 1700, protein_goal_default: 100, day_boundary_hour: 5 }, { applyToToday: false });
  const { doc } = loadSample();
  const incoming = structuredClone(doc);
  incoming.foods[1].kcal_book = 80;
  await app.applyImport(app.planImport(incoming, 'library_only', { applySettings: false }));
  assert.equal(app.foods.get('t_egg').kcal_book, 80);
  assert.equal(app.settings.kcal_goal_default, 1700);
  assert.equal(app.entriesOf()[0].unit_kcal_snapshot, 75, '已記的紀錄不受影響');
  await app.applyImport(app.planImport(incoming, 'library_only', { applySettings: true }));
  assert.equal(app.settings.kcal_goal_default, 1800);
});

test('備份提醒：沒備份過、超過 7 天、稍後可延一天', async () => {
  const { app, clk } = await setup();
  assert.deepEqual(app.backupReminder(), { kind: 'never' });
  await app.snoozeBackupReminder(1);
  assert.equal(app.backupReminder(), null);
  clk.advance(25 * 3600_000);
  assert.deepEqual(app.backupReminder(), { kind: 'never' });
  await app.exportBackup('full');
  assert.equal(app.backupReminder(), null);
  clk.advance(8 * 24 * 3600_000);
  assert.deepEqual(app.backupReminder(), { kind: 'stale', days: 8 });
  const blank = await setup({ importSample: false });
  assert.equal(blank.app.backupReminder(), null, '還沒設定好食物庫時不提醒');
});

test('App 產生的摘要含目前帳本；問答格式不會被貼回成紀錄', async () => {
  const { app } = await setup();
  await app.quickAddPreset('t_lunch');
  const text = app.gptSummary({ question: 'dinner', extra: '想在全家吃' });
  assert.match(text, /剩餘 1,060 kcal/);
  assert.match(text, /想在全家吃/);
  assert.equal(app.parseGpt(text).items.length, 0);
});

// 首次開啟：用同一條程式路徑匯入真正的私有種子（沒有種子檔就跳過）
const SEED = new URL('../private/seed.json', import.meta.url);
test('首次開啟：匯入 private/seed.json → 11 項食物、3 組套餐、快捷格 12 格，可以直接記錄', { skip: !existsSync(SEED) && '沒有 private/seed.json' }, async () => {
  const { app } = await setup({ importSample: false });
  assert.equal(app.needsSetup, true);
  const { doc, error } = parseBackupText(readFileSync(SEED, 'utf8'));
  assert.equal(error, undefined);
  const plan = app.planImport(doc, 'library_only', { applySettings: true });
  assert.equal(plan.ok, true, plan.errors.join('\n'));
  await app.applyImport(plan);
  assert.equal(app.needsSetup, false);
  assert.equal(app.foods.size, 11);
  assert.equal(app.presets.size, 3);
  assert.equal(app.quickGrid().length, 12);
  assert.ok(app.quickGrid().every((c) => !c.missing));

  // 規格範例：老樣子×1＋茶葉蛋×2 → 395／剩 1405／蛋白質 12 g＋1 項未知
  await app.quickAddFood('latte_regular');
  await app.quickAddFood('tea_egg');
  await app.quickAddFood('tea_egg');
  let t = app.totals();
  assert.deepEqual([t.eaten_kcal, t.remaining_kcal, t.protein_known_g, t.protein_unknown_count], [395, 1405, 12, 1]);
  assert.equal(app.entriesOf().find((e) => e.food_id === 'latte_regular').needs_confirm_snapshot, true);

  // 南加州午餐 740／62 → 改一顆蛋 665／56
  const base = app.totals().eaten_kcal;
  await app.quickAddPreset('preset_cal_lunch');
  t = app.totals();
  assert.equal(t.eaten_kcal - base, 740);
  assert.equal(t.protein_known_g - 12, 62);
  const egg = app.listView().find((x) => x.type === 'group').entries.find((e) => e.food_id === 'tea_egg');
  await app.setEntryQty(egg.id, 1);
  assert.equal(app.totals().eaten_kcal - base, 665);
  assert.equal(app.totals().protein_known_g - 12, 56);

  // 三個整餐模板
  await app.quickAddFood('breakfast_combo', { level: 'high' });
  assert.equal(app.entriesOf().find((e) => e.food_id === 'breakfast_combo').unit_kcal_snapshot, 1350);
});
