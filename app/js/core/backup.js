// 備份與匯入：全部是純函式。真正寫入資料庫由 app/state.js 在單一交易內完成。
// 快照（snapshot）形狀：{ foods[], presets[], days[], entries[], settings }
import { BACKUP_FORMAT, SCHEMA_VERSION } from './constants.js';
import { validateFullDoc, validateLibraryDoc } from './validate.js';

export const APP_VERSION = '1.1.0';

export function defaultSettings() {
  return {
    kcal_goal_default: 1800,
    protein_goal_default: 110,
    day_boundary_hour: 5,
    quick_slots: [],
    last_export_at: null,
  };
}

export function buildBackup(snapshot, { now = new Date(), scope = 'full' } = {}) {
  const doc = {
    format: BACKUP_FORMAT,
    schema_version: SCHEMA_VERSION,
    scope,
    created_at: now.toISOString(),
    app_version: APP_VERSION,
    foods: snapshot.foods,
    presets: snapshot.presets,
    settings: snapshot.settings,
  };
  if (scope === 'full') {
    doc.days = snapshot.days;
    doc.entries = snapshot.entries;
  }
  return doc;
}

export function serializeBackup(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// 讀取使用者選的檔案或貼上的文字。回傳 { doc, error }
export function parseBackupText(text) {
  const t = String(text ?? '').replace(/^﻿/, '').trim();
  if (!t) return { error: '內容是空的' };
  try {
    const doc = JSON.parse(t);
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { error: '不是有效的備份或食物清單檔' };
    return { doc };
  } catch {
    return { error: '無法讀取：這不是有效的 JSON 檔案' };
  }
}

const byId = (list) => new Map(list.map((x) => [x.id, x]));

function diffById(current, incoming) {
  const cur = byId(current);
  let add = 0;
  let update = 0;
  let same = 0;
  let localNewer = 0;
  for (const item of incoming) {
    const old = cur.get(item.id);
    if (!old) add += 1;
    else if (JSON.stringify(old) === JSON.stringify(item)) same += 1;
    else {
      update += 1;
      if ((old.updated_at ?? '') > (item.updated_at ?? '')) localNewer += 1;
    }
  }
  return { incoming: incoming.length, add, update, same, localNewer };
}

// 規劃匯入（不寫入）。mode：'library_only'（僅食物庫）或 'replace_all'（完整取代）。
// 回傳 { ok, errors, warnings, summary, result }；result 是套用後的快照。
export function planImport(current, doc, mode, { applySettings = false } = {}) {
  const check = mode === 'replace_all' ? validateFullDoc(doc) : validateLibraryDoc(doc);
  const errors = [...check.errors];
  const warnings = [...check.warnings];
  if (errors.length) return { ok: false, mode, errors, warnings, summary: null, result: null };

  if (mode === 'replace_all') {
    const curEntries = byId(current.entries);
    const inc = byId(doc.entries);
    let localOnly = 0;
    let localNewer = 0;
    for (const [id, e] of curEntries) {
      const other = inc.get(id);
      if (!other) localOnly += 1;
      else if (e.updated_at > other.updated_at) localNewer += 1;
    }
    const summary = {
      foods: diffById(current.foods, doc.foods),
      presets: diffById(current.presets, doc.presets),
      entries: { incoming: doc.entries.length, current: current.entries.length, localOnly, localNewer },
      days: { incoming: doc.days.length, current: current.days.length },
      backupCreatedAt: doc.created_at ?? null,
    };
    if (localOnly > 0) warnings.push(`本機有 ${localOnly} 筆紀錄不在這份備份裡，取代後會消失`);
    if (localNewer > 0) warnings.push(`本機有 ${localNewer} 筆紀錄比備份裡的版本新，取代後會變回舊版本`);
    return {
      ok: true, mode, errors, warnings, summary,
      result: {
        foods: doc.foods,
        presets: doc.presets,
        days: doc.days,
        entries: doc.entries,
        settings: { ...doc.settings },
      },
    };
  }

  // 僅食物庫：依 id 新增或取代；本機有、檔案沒有的食物與套餐原樣保留；紀錄與每日目標完全不動
  const foods = [...byId([...current.foods, ...doc.foods]).values()];
  const presets = [...byId([...current.presets, ...doc.presets]).values()];
  let settings = current.settings;
  if (applySettings) {
    if (doc.settings) {
      settings = { ...doc.settings, last_export_at: current.settings.last_export_at ?? doc.settings.last_export_at ?? null };
    } else warnings.push('這個檔案沒有設定，已略過套用設定');
  }
  const merged = validateLibraryDoc({
    format: BACKUP_FORMAT, schema_version: SCHEMA_VERSION, scope: 'library', foods, presets, settings,
  });
  if (merged.errors.length) {
    return { ok: false, mode, errors: merged.errors, warnings, summary: null, result: null };
  }
  const summary = {
    foods: diffById(current.foods, doc.foods),
    presets: diffById(current.presets, doc.presets),
    applySettings: applySettings && Boolean(doc.settings),
  };
  if (summary.foods.localNewer > 0) warnings.push(`有 ${summary.foods.localNewer} 項食物在本機比檔案裡新，匯入後會變回檔案裡的版本`);
  return {
    ok: true, mode, errors, warnings, summary,
    result: { foods, presets, days: current.days, entries: current.entries, settings },
  };
}
