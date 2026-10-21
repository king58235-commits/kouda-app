import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { buildBackup, defaultSettings, parseBackupText, planImport, serializeBackup } from '../app/js/core/backup.js';
import { entriesFromPreset, entryFromFood } from '../app/js/core/ledger.js';
import { presetTotals } from '../app/js/core/summary.js';
import { indexById } from '../app/js/core/ledger.js';
import { idSeq, loadSample, NOW } from './helpers.js';

const empty = () => ({ foods: [], presets: [], days: [], entries: [], settings: defaultSettings() });

function fullSnapshot() {
  const { doc, foods, presets } = loadSample();
  const { entries } = entriesFromPreset(presets.get('t_lunch'), foods, { dietDay: '2026-10-21', now: NOW, makeId: idSeq('e') });
  entries.push(entryFromFood(foods.get('t_latte'), { dietDay: '2026-10-21', id: 'solo', now: NOW }));
  return {
    foods: doc.foods,
    presets: doc.presets,
    days: [{ diet_day: '2026-10-21', kcal_goal: 1800, protein_goal: 110 }],
    entries,
    settings: { ...doc.settings },
  };
}

test('完整匯出 → 匯入到空白資料庫 → 內容完全一致（T10）', () => {
  const snap = fullSnapshot();
  const text = serializeBackup(buildBackup(snap, { now: NOW }));
  const { doc, error } = parseBackupText(text);
  assert.equal(error, undefined);
  const plan = planImport(empty(), doc, 'replace_all');
  assert.equal(plan.ok, true, plan.errors.join('\n'));
  assert.deepEqual(plan.result, snap);
});

test('同一份備份取代兩次，結果相同、不會倍增', () => {
  const snap = fullSnapshot();
  const { doc } = parseBackupText(serializeBackup(buildBackup(snap, { now: NOW })));
  const once = planImport(empty(), doc, 'replace_all').result;
  const twice = planImport(once, doc, 'replace_all').result;
  assert.deepEqual(twice, once);
  assert.equal(twice.entries.length, snap.entries.length);
});

test('完整取代前預覽：本機獨有／較新的紀錄會被警告', () => {
  const snap = fullSnapshot();
  const { doc } = parseBackupText(serializeBackup(buildBackup(snap, { now: NOW })));
  const local = structuredClone(snap);
  local.entries.push({ ...local.entries[0], id: 'only-local' });
  local.entries[1].updated_at = '2099-01-01T00:00:00.000Z';
  const plan = planImport(local, doc, 'replace_all');
  assert.equal(plan.summary.entries.localOnly, 1);
  assert.equal(plan.summary.entries.localNewer, 1);
  assert.ok(plan.warnings.some((w) => w.includes('會消失')));
  assert.ok(plan.warnings.some((w) => w.includes('變回舊版本')));
});

test('食物庫備份不能拿來完整取代；有錯的檔案不會產生結果', () => {
  const { doc } = loadSample();
  const plan = planImport(empty(), doc, 'replace_all');
  assert.equal(plan.ok, false);
  assert.equal(plan.result, null);
  assert.ok(plan.errors.some((e) => e.includes('完整備份')));

  const broken = structuredClone(fullSnapshot());
  const bad = buildBackup(broken, { now: NOW });
  bad.entries[0].qty = 0;
  const p2 = planImport(empty(), bad, 'replace_all');
  assert.equal(p2.ok, false);
  assert.ok(p2.errors.some((e) => e.includes('份量')));
});

test('僅匯入食物庫：依 id 新增／取代，保留本機其他食物，不動紀錄與每日目標', () => {
  const snap = fullSnapshot();
  const { doc } = loadSample();
  const incoming = structuredClone(doc);
  incoming.foods[0].kcal_book = 999;
  incoming.foods.push({ ...incoming.foods[1], id: 't_new', short_label: '新食物' });
  const local = structuredClone(snap);
  local.foods.push({ ...local.foods[1], id: 'only_local', short_label: '本機獨有' });

  const plan = planImport(local, incoming, 'library_only', { applySettings: false });
  assert.equal(plan.ok, true, plan.errors.join('\n'));
  const ids = plan.result.foods.map((f) => f.id);
  assert.ok(ids.includes('only_local') && ids.includes('t_new'));
  assert.equal(plan.result.foods.find((f) => f.id === 't_latte').kcal_book, 999);
  assert.deepEqual(plan.result.entries, local.entries);
  assert.deepEqual(plan.result.days, local.days);
  assert.deepEqual(plan.result.settings, local.settings);
  assert.equal(plan.summary.foods.add, 1);
  assert.equal(plan.summary.foods.update, 1);
});

test('僅匯入食物庫：勾選才套用設定；不會覆蓋本機的最後備份時間', () => {
  const snap = fullSnapshot();
  snap.settings.last_export_at = '2026-10-20T00:00:00.000Z';
  snap.settings.kcal_goal_default = 1700;
  const { doc } = loadSample();
  const keep = planImport(snap, doc, 'library_only', { applySettings: false });
  assert.equal(keep.result.settings.kcal_goal_default, 1700);
  const apply = planImport(snap, doc, 'library_only', { applySettings: true });
  assert.equal(apply.result.settings.kcal_goal_default, 1800);
  assert.equal(apply.result.settings.last_export_at, '2026-10-20T00:00:00.000Z');
});

test('食物庫匯入後引用不完整會被擋下（快捷格指向不存在的食物）', () => {
  const { doc } = loadSample();
  const incoming = structuredClone(doc);
  incoming.settings.quick_slots = [{ type: 'food', id: 'ghost' }];
  const plan = planImport(empty(), incoming, 'library_only', { applySettings: true });
  assert.equal(plan.ok, false);
});

test('讀檔：空內容、不是 JSON、不是物件、BOM', () => {
  assert.ok(parseBackupText('').error);
  assert.ok(parseBackupText('hello').error);
  assert.ok(parseBackupText('[1,2]').error);
  assert.ok(parseBackupText('null').error);
  assert.equal(parseBackupText('﻿{"a":1}').doc.a, 1);
});

test('較新版本的備份會被拒絕', () => {
  const doc = buildBackup(fullSnapshot(), { now: NOW });
  doc.schema_version = 99;
  assert.equal(planImport(empty(), doc, 'replace_all').ok, false);
});

// 首次開啟 App：私有種子（11 項食物＋3 組套餐）必須能經由同一條匯入路徑進來
const SEED = new URL('../private/seed.json', import.meta.url);
test('首次開啟：private/seed.json 匯入空白 App → 11 項食物、3 組套餐、12 格快捷、設定正確', { skip: !existsSync(SEED) && '沒有 private/seed.json' }, () => {
  const { doc, error } = parseBackupText(readFileSync(SEED, 'utf8'));
  assert.equal(error, undefined);
  const plan = planImport(empty(), doc, 'library_only', { applySettings: true });
  assert.equal(plan.ok, true, plan.errors.join('\n'));
  const r = plan.result;
  assert.equal(r.foods.length, 11);
  assert.equal(r.presets.length, 3);
  assert.equal(r.settings.quick_slots.length, 12);
  assert.deepEqual([r.settings.kcal_goal_default, r.settings.protein_goal_default, r.settings.day_boundary_hour], [1800, 110, 5]);
  assert.equal(plan.summary.foods.add, 11);

  const foods = indexById(r.foods);
  const totals = Object.fromEntries(r.presets.map((p) => [p.label, presetTotals(p, foods)]));
  assert.deepEqual(totals['南加州午餐'], { kcal: 740, protein_known_g: 62, protein_unknown_count: 0 });
  assert.deepEqual(totals['南加州＋蛋'], { kcal: 620, protein_known_g: 54, protein_unknown_count: 0 });
  assert.equal(totals['全家晚餐'].kcal, 750);
  const latte = foods.get('latte_regular');
  assert.deepEqual([latte.kcal_book, latte.protein_book, latte.needs_confirm, latte.source_type], [245, null, true, 'legacy_estimate']);
  const box = foods.get('box_cal_chicken');
  assert.deepEqual([box.kcal_book, box.protein_book, box.needs_confirm], [470, 42, true]);
  for (const id of ['braised', 'buffet', 'breakfast_combo']) assert.equal(foods.get(id).kind, 'opaque');
});
