// V1.1 智慧紀錄：最近／最常吃（UX12）、複製舊餐（UX13／14）、建套餐（UX15／16）、搜尋（UX17）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildItems, classifyEntries, findDuplicatePreset, findSameName, valueChanges } from '../app/js/core/compose.js';
import { daysWithEntries, selectableUnits, snapshotDiffs, totalsOfUnits } from '../app/js/core/copy.js';
import { entriesFromPreset, entryFromFood, gptEntry, roughEntry } from '../app/js/core/ledger.js';
import { normalizeQuery, searchLibrary } from '../app/js/core/search.js';
import { recentAndFrequent } from '../app/js/core/recent.js';
import { validateEntry } from '../app/js/core/validate.js';
import { newId } from '../app/js/core/ids.js';
import { foodFromForm } from '../app/js/core/library.js';
import { KoudaApp } from '../app/js/state.js';
import { MemoryRepo } from './support/memory-repo.js';
import { idSeq, loadSample } from './helpers.js';

function clock(y = 2026, mo = 10, d = 21, h = 12, mi = 40) {
  const c = { t: new Date(y, mo - 1, d, h, mi, 0) };
  c.now = () => new Date(c.t);
  c.set = (y, mo, d, h, mi = 0) => { c.t = new Date(y, mo - 1, d, h, mi, 0); };
  c.advance = (ms) => { c.t = new Date(c.t.getTime() + ms); };
  return c;
}

async function setup(clk = clock()) {
  const app = new KoudaApp(new MemoryRepo(), { now: clk.now });
  await app.init();
  const { doc } = loadSample();
  await app.applyImport(app.planImport(doc, 'library_only', { applySettings: true }));
  return { app, clk };
}

const copyIds = () => {
  const m = new Map();
  const g = new Map();
  return {
    entry: (id) => { if (!m.has(id)) m.set(id, newId()); return m.get(id); },
    group: (id) => { if (!g.has(id)) g.set(id, newId()); return g.get(id); },
  };
};

// 10/19、10/20 各記一些，今天是 10/21
async function history(app, clk) {
  clk.set(2026, 10, 19, 8, 0);
  app.setWorkingDay('2026-10-19');
  await app.quickAddFood('t_egg'); clk.advance(60_000 * 30);
  await app.quickAddPreset('t_lunch'); clk.advance(60_000 * 30);
  await app.addRough({ kcal: 450, name: '雞肉飯' }); clk.advance(60_000 * 30);
  clk.set(2026, 10, 20, 8, 0);
  app.setWorkingDay('2026-10-20');
  await app.quickAddFood('t_egg'); clk.advance(60_000 * 30);
  await app.quickAddFood('t_egg'); clk.advance(60_000 * 60);
  await app.quickAddPreset('t_lunch'); clk.advance(60_000 * 30);
  clk.set(2026, 10, 21, 12, 0);
  app.setWorkingDay('2026-10-21');
}

// ---------- UX12 最近／最常吃 ----------

test('UX12 套餐組件不會虛增單品使用次數；套餐整組算一次', async () => {
  const { app, clk } = await setup();
  await history(app, clk);
  app.settings.quick_slots.length = 0; // 先當作沒有任何快捷格，才看得到完整排行
  const r = app.recentItems();
  const egg = r.frequent.find((x) => x.id === 't_egg');
  const lunch = r.frequent.find((x) => x.id === 't_lunch');
  assert.equal(egg.uses, 3, '3 次獨立點選，套餐裡的 2×2 顆不算');
  assert.equal(lunch.uses, 2, '套餐兩組');
  assert.equal(r.frequent[0].id, 't_egg');
  assert.equal(r.recent[0].lastAt >= r.recent[1].lastAt, true);
});

test('UX12 已封存、已不存在、已在快捷格上的不推薦；最近排序正確', async () => {
  const { app, clk } = await setup();
  await history(app, clk);
  const slots = app.settings.quick_slots;
  const base = { entries: [...app.db.entries.values()], foods: app.foods, presets: app.presets, today: '2026-10-21' };

  const all = recentAndFrequent({ ...base, quickSlots: [] });
  assert.deepEqual(all.recent.map((x) => x.id).sort(), ['t_egg', 't_lunch']);

  const inGrid = recentAndFrequent({ ...base, quickSlots: slots });
  assert.deepEqual(inGrid.recent, [], '都已在快捷格就是空的');

  const archivedFoods = new Map(app.foods);
  archivedFoods.set('t_egg', { ...app.foods.get('t_egg'), archived: true });
  const arch = recentAndFrequent({ ...base, foods: archivedFoods, quickSlots: [] });
  assert.ok(!arch.recent.some((x) => x.id === 't_egg'));
  assert.ok(arch.recent.some((x) => x.id === 't_lunch'));

  const noPreset = recentAndFrequent({ ...base, presets: new Map(), quickSlots: [] });
  assert.ok(!noPreset.recent.some((x) => x.id === 't_lunch'));
});

test('UX12 最常吃只算最近 30 個飲食日；沒有歷史有自然的空結果', async () => {
  const { app } = await setup();
  assert.deepEqual(recentAndFrequent({
    entries: [], foods: app.foods, presets: app.presets, quickSlots: [], today: '2026-10-21',
  }), { recent: [], frequent: [] });

  const { foods } = loadSample();
  const old = entryFromFood(foods.get('t_soy'), { dietDay: '2026-08-01', id: 'old' });
  const r = recentAndFrequent({ entries: [old], foods: app.foods, presets: app.presets, quickSlots: [], today: '2026-10-21' });
  assert.equal(r.recent[0].id, 't_soy');
  assert.deepEqual(r.frequent, [], '超過 30 天的不算常吃');
});

test('UX12 粗估／GPT 存成快捷的食物（有 food_id）算一次使用', () => {
  const { foods, presets } = loadSample();
  const gpt = gptEntry({ dietDay: '2026-10-21', kcal: 300, name: '鮪魚吐司', foodId: 't_soy', gptRawLine: '@扣打 x' });
  const noFood = roughEntry({ dietDay: '2026-10-21', kcal: 500, name: '亂吃' });
  const r = recentAndFrequent({ entries: [gpt, noFood], foods, presets, quickSlots: [], today: '2026-10-21' });
  assert.deepEqual(r.recent.map((x) => x.id), ['t_soy']);
});

// ---------- UX13／UX14 複製舊餐 ----------

test('UX13 從昨天複製一筆與一個套餐到今天：新 id、新 group_id、新時間與日期；原紀錄不變；今天只計一次', async () => {
  const { app, clk } = await setup();
  await history(app, clk);
  const before20 = JSON.stringify(app.entriesOf('2026-10-20'));
  const units = app.copyUnits('2026-10-20');
  assert.deepEqual(units.map((u) => u.type), ['entry', 'entry', 'group']);
  const selection = [{ type: 'entry', id: units[0].id }, { type: 'group', id: units[2].id }];
  const ids = copyIds();
  const r = await app.copyFromDay({ sourceDay: '2026-10-20', selection, ids });
  assert.equal(r.count, 4);

  const today = app.entriesOf('2026-10-21');
  assert.equal(today.length, 4);
  const srcIds = new Set(app.entriesOf('2026-10-20').map((e) => e.id));
  assert.ok(today.every((e) => !srcIds.has(e.id)), '全部是新 id');
  const group = today.filter((e) => e.group_id);
  assert.equal(group.length, 3);
  assert.equal(new Set(group.map((e) => e.group_id)).size, 1);
  assert.notEqual(group[0].group_id, units[2].id, '新群組 id，不和原群組共用');
  assert.ok(today.every((e) => e.diet_day === '2026-10-21' && e.created_at >= '2026-10-21'));
  assert.equal(JSON.stringify(app.entriesOf('2026-10-20')), before20, '昨天的紀錄沒被改');
  assert.equal(app.totals('2026-10-21').eaten_kcal, 75 + 740);
  assert.ok(today.every((e) => validateEntry(e).errors.length === 0));

  // 同一個確認畫面重複送出：不會再多記
  const again = await app.copyFromDay({ sourceDay: '2026-10-20', selection, ids });
  assert.equal(again.count, 0);
  assert.equal(app.entriesOf('2026-10-21').length, 4);

  // 撤銷：複製的整批移除，今天回到 0
  await app.undo(r.undoId);
  assert.equal(app.entriesOf('2026-10-21').length, 0);
  assert.equal(JSON.stringify(app.entriesOf('2026-10-20')), before20);
});

test('UX14 食物庫數字改過後再複製舊日：照「舊紀錄快照」複製並提醒差異', async () => {
  const { app, clk } = await setup();
  await history(app, clk);
  const { food } = foodFromForm({ ...app.foods.get('t_egg'), kcal_book: '90', protein_book: '7' }, app.foods.get('t_egg'), clk.now());
  await app.saveFood(food);
  const units = app.copyUnits('2026-10-20');
  const diffs = snapshotDiffs([units[0]], app.foods);
  assert.deepEqual(diffs.map((d) => [d.label, d.was.kcal, d.now.kcal, d.was.protein, d.now.protein]), [['測試蛋', 75, 90, 6, 7]]);

  await app.copyFromDay({ sourceDay: '2026-10-20', selection: [{ type: 'entry', id: units[0].id }], ids: copyIds() });
  const copied = app.entriesOf('2026-10-21')[0];
  assert.equal(copied.unit_kcal_snapshot, 75, '用的是原紀錄的快照，不是現在的 90');
  assert.equal(copied.unit_protein_snapshot, 6);
  assert.equal(app.totals('2026-10-21').eaten_kcal, 75);
});

test('複製：粗估紀錄（沒有食物庫對應）也能安全複製並保留原快照；同一天不能複製；沒選不能複製', async () => {
  const { app, clk } = await setup();
  await history(app, clk);
  const rough = app.copyUnits('2026-10-19').find((u) => u.label === '雞肉飯');
  await app.copyFromDay({ sourceDay: '2026-10-19', selection: [{ type: 'entry', id: rough.id }], ids: copyIds() });
  const e = app.entriesOf('2026-10-21')[0];
  assert.deepEqual([e.origin, e.food_id, e.unit_kcal_snapshot, e.unit_protein_snapshot], ['rough', null, 450, null]);
  await assert.rejects(() => app.copyFromDay({ sourceDay: '2026-10-19', selection: [], ids: copyIds() }), /沒有選任何項目/);
  await assert.rejects(() => app.copyFromDay({ sourceDay: '2026-10-21', selection: [{ type: 'entry', id: e.id }], ids: copyIds() }), /相同/);
});

test('複製的寫入失敗：今天不會多出半套紀錄', async () => {
  const clk = clock();
  const repo = new MemoryRepo();
  const app = new KoudaApp(repo, { now: clk.now });
  await app.init();
  const { doc } = loadSample();
  await app.applyImport(app.planImport(doc, 'library_only', { applySettings: true }));
  await history(app, clk);
  const units = app.copyUnits('2026-10-20');
  const before = JSON.stringify(app.snapshot());
  repo.failNext = true;
  await assert.rejects(() => app.copyFromDay({ sourceDay: '2026-10-20', selection: units.map((u) => ({ type: u.type, id: u.id })), ids: copyIds() }));
  assert.equal(JSON.stringify(app.snapshot()), before);
});

test('複製的輔助：有紀錄的日子（新的在前、不含目標日）、合計預覽', async () => {
  const { app, clk } = await setup();
  await history(app, clk);
  const days = daysWithEntries([...app.db.entries.values()], '2026-10-21');
  assert.deepEqual(days.map((d) => d.day), ['2026-10-20', '2026-10-19']);
  const units = selectableUnits([...app.db.entries.values()], '2026-10-20');
  const t = totalsOfUnits(units);
  assert.equal(t.kcal, 75 + 75 + 740);
  assert.equal(t.unknown, 0);
});

// ---------- UX15／UX16 從今日已記建立套餐 ----------

test('UX15 今日選三個食物存成套餐：可命名、預覽合計、存進套餐庫；今天的數字不增加', async () => {
  const { app } = await setup();
  await app.quickAddFood('t_box');
  await app.quickAddFood('t_soy');
  await app.quickAddFood('t_latte');
  const eatenBefore = app.totals().eaten_kcal;
  const entriesBefore = app.entriesOf().length;
  const cls = classifyEntries(app.entriesOf(), app.foods);
  assert.ok(cls.every((c) => c.ok));
  const picks = cls.map((c) => ({ entry: c.entry, foodId: c.foodId, qty: c.entry.qty }));
  const items = buildItems(picks);
  const r = await app.createPresetFromEntries({ label: '我的晚餐', items, addToQuick: false });
  const preset = app.presets.get(r.presetId);
  assert.equal(preset.label, '我的晚餐');
  assert.deepEqual(Object.keys(preset).filter((k) => /kcal|protein/.test(k)), [], '套餐不存熱量');
  assert.equal(app.totals().eaten_kcal, eatenBefore);
  assert.equal(app.entriesOf().length, entriesBefore);
  await app.quickAddPreset(preset.id);
  assert.equal(app.totals().eaten_kcal, eatenBefore + 470 + 120 + 245, '之後記入時才以食物庫現算');
});

test('UX15 規格範例：雞胸餐盒＋豆奶＋全家漢堡 = 750 kcal／52.8 g', async () => {
  const { app } = await setup();
  const mk = (id, short, kcal, protein) => foodFromForm({
    short_label: short, full_name: short, kind: 'single', unit: '份', kcal_book: String(kcal), protein_book: String(protein), source_type: 'label', source_note: '測試',
  }, null, new Date()).food;
  const box = { ...mk('b', '雞胸餐盒', 360, 22.8), id: 'f_box' };
  const soy = { ...mk('s', '豆奶', 153, 15.1), id: 'f_soy' };
  const burger = { ...mk('h', '全家漢堡', 237, 14.9), id: 'f_burger' };
  for (const f of [box, soy, burger]) await app.saveFood(f);
  for (const id of ['f_box', 'f_soy', 'f_burger']) await app.quickAddFood(id);
  const cls = classifyEntries(app.entriesOf(), app.foods);
  const items = buildItems(cls.map((c) => ({ entry: c.entry, foodId: c.foodId, qty: c.entry.qty })));
  const r = await app.createPresetFromEntries({ label: '全家晚餐', items });
  const { presetTotals } = await import('../app/js/core/summary.js');
  assert.deepEqual(presetTotals(app.presets.get(r.presetId), app.foods), { kcal: 750, protein_known_g: 52.8, protein_unknown_count: 0 });
});

test('UX15 重複防呆：同名套餐、同內容套餐會被擋下；名稱空白、空組成也不行', async () => {
  const { app } = await setup();
  await app.quickAddFood('t_egg');
  const items = [{ food_id: 't_egg', qty: 2 }];
  await assert.rejects(() => app.createPresetFromEntries({ label: '測試午餐', items }), /同名/);
  await assert.rejects(() => app.createPresetFromEntries({ label: '  ', items }), /名稱/);
  await assert.rejects(() => app.createPresetFromEntries({ label: 'x', items: [] }), /至少/);
  await app.createPresetFromEntries({ label: '兩顆蛋', items });
  await assert.rejects(() => app.createPresetFromEntries({ label: '另一個名字', items }), /相同內容的套餐「兩顆蛋」/);
  assert.equal(findDuplicatePreset(app.presets, [{ food_id: 't_egg', qty: 2 }]).label, '兩顆蛋');
  assert.equal(findSameName(app.presets, ' 兩顆蛋 ').label, '兩顆蛋');
});

test('UX15 儲存時可加入快捷格；快捷格已滿時仍建立套餐並回報 quickFull', async () => {
  const { app } = await setup();
  const r = await app.createPresetFromEntries({ label: 'A 套餐', items: [{ food_id: 't_egg', qty: 1 }], addToQuick: true });
  assert.deepEqual(app.settings.quick_slots.at(-1), { type: 'preset', id: r.presetId });
  assert.equal(r.quickFull, false);
  for (let i = app.settings.quick_slots.length; i < 12; i += 1) {
    await app.createPresetFromEntries({ label: `填滿 ${i}`, items: [{ food_id: 't_egg', qty: i + 2 }], addToQuick: true });
  }
  assert.equal(app.settings.quick_slots.length, 12);
  const full = await app.createPresetFromEntries({ label: '放不下', items: [{ food_id: 't_soy', qty: 1 }], addToQuick: true });
  assert.equal(full.quickFull, true);
  assert.ok(app.presets.has(full.presetId));
  assert.equal(app.settings.quick_slots.length, 12);
});

test('UX15 新套餐用目前食物庫的數值：列出和原紀錄快照不同的項目', async () => {
  const { app, clk } = await setup();
  await app.quickAddFood('t_egg');
  const { food } = foodFromForm({ ...app.foods.get('t_egg'), kcal_book: '90' }, app.foods.get('t_egg'), clk.now());
  await app.saveFood(food);
  const cls = classifyEntries(app.entriesOf(), app.foods);
  const picks = cls.map((c) => ({ entry: c.entry, foodId: c.foodId, qty: c.entry.qty }));
  const diffs = valueChanges(picks, app.foods);
  assert.deepEqual(diffs.map((d) => [d.label, d.was.kcal, d.now.kcal]), [['測試蛋', 75, 90]]);
});

test('UX16 沒有有效 food_id（粗估／GPT）：說明原因，不產生破損套餐；明確存成食物後可加入', async () => {
  const { app } = await setup();
  await app.addRough({ kcal: 800, name: '早餐店' });
  const parsed = app.parseGpt('@扣打 起司蛋餅｜熱量 600-740 kcal｜蛋白質 23 g');
  await app.commitGpt(parsed.items);
  const cls = classifyEntries(app.entriesOf(), app.foods);
  assert.ok(cls.every((c) => !c.ok && c.needsFood && /先存成食物/.test(c.reason)));
  assert.throws(() => buildItems([{ foodId: 'x', qty: 0 }]));
  await assert.rejects(() => app.createPresetFromEntries({
    label: '壞套餐', items: [{ food_id: 'ghost', qty: 1 }],
  }), /不存在的食物/);
  assert.equal([...app.presets.values()].filter((p) => p.label === '壞套餐').length, 0);

  const gptEntryRow = app.entriesOf().find((e) => e.origin === 'gpt');
  const entryBefore = JSON.stringify(gptEntryRow);
  const saved = await app.saveEntryAsFood(gptEntryRow.id);
  const food = app.foods.get(saved.foodId);
  assert.deepEqual([food.kind, food.kcal_low, food.kcal_book, food.kcal_high, food.source_type], ['opaque', 600, 670, 740, 'gpt_estimate']);
  assert.equal(JSON.stringify(app.db.entries.get(gptEntryRow.id)), entryBefore, '原紀錄不被修改');
  await assert.rejects(() => app.saveEntryAsFood('nope'));

  const roughRow = app.entriesOf().find((e) => e.origin === 'rough');
  const s2 = await app.saveEntryAsFood(roughRow.id);
  assert.deepEqual([app.foods.get(s2.foodId).kind, app.foods.get(s2.foodId).kcal_book, app.foods.get(s2.foodId).protein_book], ['single', 800, null]);
  const r = await app.createPresetFromEntries({ label: '早餐組', items: [{ food_id: s2.foodId, qty: 1 }, { food_id: saved.foodId, qty: 1 }] });
  assert.ok(app.presets.has(r.presetId));
});

test('UX16 已封存、已不存在的食物在紀錄裡也不能直接進套餐', async () => {
  const { app } = await setup();
  await app.quickAddFood('t_egg');
  await app.archiveFood('t_egg', true);
  const cls = classifyEntries(app.entriesOf(), app.foods);
  assert.equal(cls[0].ok, false);
  assert.match(cls[0].reason, /已封存/);
  const gone = classifyEntries(app.entriesOf(), new Map());
  assert.match(gone[0].reason, /找不到/);
});

test('buildItems：同一個食物合併份量、順序依第一次出現', () => {
  const items = buildItems([
    { foodId: 'a', qty: 1 }, { foodId: 'b', qty: 2 }, { foodId: 'a', qty: 0.5 },
  ]);
  assert.deepEqual(items, [{ food_id: 'a', qty: 1.5 }, { food_id: 'b', qty: 2 }]);
});

// ---------- UX17 搜尋 ----------

test('UX17 搜尋：短名、完整名、套餐名與其組成；空白、大小寫、全形都容錯；空結果', async () => {
  const { app } = await setup();
  const find = (q) => {
    const r = searchLibrary({ foods: app.foods, presets: app.presets, query: q });
    return [...r.foods.map((f) => f.short_label), ...r.presets.map((p) => p.label)];
  };
  assert.deepEqual(find('測試蛋'), ['測試蛋', '測試午餐']);
  assert.deepEqual(find('  整餐  '), ['測試整餐']);
  assert.deepEqual(find('拿鐵'), ['測試拿鐵', '測試豆漿', '測試午餐']);
  assert.deepEqual(find('測試 午餐'), ['測試午餐']);
  assert.deepEqual(find('ＡＢＣ'), []);
  assert.deepEqual(find('zzzz'), []);
  assert.equal(find('').length, 6);
  assert.equal(normalizeQuery('  ＬＡＴＴＥ  Tea  '), 'latte tea');

  const { food } = foodFromForm({
    short_label: 'Latte', full_name: 'Oat Latte', kind: 'single', unit: '杯', kcal_book: '150', source_type: 'label', source_note: 'x',
  }, null, new Date());
  await app.saveFood(food);
  assert.ok(find('LATTE').includes('Latte'));
  assert.ok(find('oat').includes('Latte'));
  await app.archiveFood(food.id, true);
  assert.ok(find('latte').includes('Latte'), '封存的也找得到（食物庫會放在已封存區）');
});
