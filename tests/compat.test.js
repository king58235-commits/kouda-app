// V1 → V1.1 資料相容性（UX20）：舊備份、舊資料庫格式、不重設資料。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { APP_VERSION, parseBackupText } from '../app/js/core/backup.js';
import { BACKUP_FORMAT, SCHEMA_VERSION } from '../app/js/core/constants.js';
import { validateFullDoc } from '../app/js/core/validate.js';
import { KoudaApp } from '../app/js/state.js';
import { DB_NAME, DB_VERSION, STORES } from '../app/js/store/schema.js';
import { MemoryRepo } from './support/memory-repo.js';

const FIXTURE = new URL('./fixtures/v1-backup.json', import.meta.url);
const raw = readFileSync(FIXTURE, 'utf8');
const clock = () => new Date(2026, 9, 21, 12, 0);

test('UX20 資料庫結構與資料格式版本沒有變動（V1.1 不會觸發資料庫升級或重設）', () => {
  assert.equal(DB_NAME, 'kouda-v1');
  assert.equal(DB_VERSION, 1);
  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(BACKUP_FORMAT, 'kouda-backup');
  assert.deepEqual(STORES, { foods: 'id', presets: 'id', days: 'diet_day', entries: 'id', meta: 'key' });
  assert.equal(APP_VERSION, '1.1.0');
});

test('UX20 V1 產生的完整備份通過 V1.1 的檢查', () => {
  const { doc } = parseBackupText(raw);
  assert.equal(doc.app_version, '1.0.0');
  assert.deepEqual(validateFullDoc(doc).errors, []);
});

test('UX20 把 V1 備份還原到 V1.1：食物、套餐、設定、每日目標、紀錄與熱量完全一致', async () => {
  const { doc } = parseBackupText(raw);
  const app = new KoudaApp(new MemoryRepo(), { now: clock });
  await app.init();
  await app.applyImport(app.planImport(doc, 'replace_all'));
  const snap = app.snapshot();
  const byId = (a) => [...a].sort((x, y) => (x.id ?? x.diet_day) < (y.id ?? y.diet_day) ? -1 : 1);
  assert.deepEqual(byId(snap.foods), byId(doc.foods));
  assert.deepEqual(byId(snap.presets), byId(doc.presets));
  assert.deepEqual(byId(snap.entries), byId(doc.entries));
  assert.deepEqual(byId(snap.days), byId(doc.days));
  assert.deepEqual(snap.settings, doc.settings);

  const t19 = app.totals('2026-10-19');
  const t20 = app.totals('2026-10-20');
  assert.deepEqual([t19.eaten_kcal, t19.entry_count], [245 + 740 + 760 + 450, 6]);
  assert.deepEqual([t20.eaten_kcal, t20.entry_count, t20.gpt_count], [75 + 75 + 670, 3, 1]);
});

test('UX20 V1 的資料在 V1.1 能照常使用新功能（減號、複製、建套餐），舊紀錄不被改動', async () => {
  const { doc } = parseBackupText(raw);
  const app = new KoudaApp(new MemoryRepo(), { now: clock });
  await app.init();
  await app.applyImport(app.planImport(doc, 'replace_all'));
  const old = JSON.stringify(app.entriesOf('2026-10-19'));
  app.setWorkingDay('2026-10-20');
  const before20 = app.totals('2026-10-20').eaten_kcal;
  await app.decrementFood('t_egg');
  assert.equal(app.totals('2026-10-20').eaten_kcal, before20 - 75);
  await app.undo();
  assert.equal(app.totals('2026-10-20').eaten_kcal, before20);

  app.setWorkingDay('2026-10-21');
  const units = app.copyUnits('2026-10-19');
  const ids = { entry: (i) => `new-${i}`, group: (i) => `ng-${i}` };
  const r = await app.copyFromDay({ sourceDay: '2026-10-19', selection: units.map((u) => ({ type: u.type, id: u.id })), ids });
  assert.equal(r.count, 6);
  assert.equal(JSON.stringify(app.entriesOf('2026-10-19')), old, 'V1 的舊紀錄沒被動到');
  assert.equal(app.totals('2026-10-21').eaten_kcal, app.totals('2026-10-19').eaten_kcal);

  // 升級後再匯出，格式仍是 V1 相容（schema_version 不變）
  const out = JSON.parse((await app.exportBackup('full')).text);
  assert.equal(out.schema_version, 1);
  assert.equal(out.app_version, '1.1.0');
  assert.deepEqual(validateFullDoc(out).errors, []);
});

test('UX20 V1.1 匯出的備份，V1 的規則（同一份檢查）也看得懂：沒有新增必填欄位', async () => {
  const { doc } = parseBackupText(raw);
  const app = new KoudaApp(new MemoryRepo(), { now: clock });
  await app.init();
  await app.applyImport(app.planImport(doc, 'replace_all'));
  const out = JSON.parse((await app.exportBackup('full')).text);
  const v1Keys = new Set(Object.keys(doc.entries[0]));
  for (const e of out.entries) assert.deepEqual(Object.keys(e).sort(), [...v1Keys].sort());
  assert.deepEqual(Object.keys(out).sort(), Object.keys(doc).sort());
});
