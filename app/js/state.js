// 應用程式狀態與所有「會改資料」的動作。
// 規則：每個動作先在單一交易內寫進資料庫，成功後才更新畫面用的記憶體資料；
// 動作一律排隊依序執行（連點、雙擊不會互相搶資料）；寫入失敗時記憶體資料維持原狀。
import {
  APP_VERSION, buildBackup, defaultSettings, planImport, serializeBackup,
} from './core/backup.js';
import { foodUsage, planDecrementFood, planDecrementPreset, presetUsage } from './core/adjust.js';
import { findDuplicatePreset, findSameName, foodDraftFromEntry } from './core/compose.js';
import { SCHEMA_VERSION } from './core/constants.js';
import { planCopy, selectableUnits } from './core/copy.js';
import { addDays, boundaryHint, dietDayOf, formatLocalDate } from './core/day.js';
import { newDay, withGoals } from './core/days.js';
import { buildSummary } from './core/gptSummary.js';
import { markDuplicates, parseGptText } from './core/gptParse.js';
import { newId } from './core/ids.js';
import {
  addSlot, foodFromGptItem, foodReferences, moveSlot, newFoodId, newPresetId, removeSlot,
} from './core/library.js';
import {
  canMergeQuickTap, entriesFromPreset, entryFromFood, gptEntry, latestEntry, roughEntry,
  withDietDay, withLevel, withQty, withValues,
} from './core/ledger.js';
import { recentAndFrequent } from './core/recent.js';
import { dayTotals, presetTotals } from './core/summary.js';
import { validateFood, validatePreset } from './core/validate.js';
import { keyOf, STORE_NAMES } from './store/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const BACKUP_STALE_DAYS = 7;

export class KoudaApp {
  constructor(repo, { now = () => new Date() } = {}) {
    this.repo = repo;
    this.now = now;
    this.listeners = new Set();
    this.db = Object.fromEntries(STORE_NAMES.map((s) => [s, new Map()]));
    this.queue = Promise.resolve();
    this.dayOverride = null;
    this.lastUndo = null;
  }

  // ---- 啟動與讀取 ----

  async init() {
    const rows = await this.repo.loadAll();
    this.#fill(rows);
    const put = { meta: [] };
    const version = this.db.meta.get('schema_version')?.value;
    if (version !== undefined && version > SCHEMA_VERSION) {
      throw new Error(`資料庫來自較新版本的 App（schema ${version}），請先更新 App。`);
    }
    if (version === undefined) put.meta.push({ key: 'schema_version', value: SCHEMA_VERSION });
    if (!this.db.meta.get('settings')) put.meta.push({ key: 'settings', value: defaultSettings() });
    if (!this.db.meta.get('first_use_at')) put.meta.push({ key: 'first_use_at', value: this.now().toISOString() });
    if (put.meta.length) await this.#write({ put });
    this.#notify();
    return this;
  }

  #fill(rows) {
    for (const s of STORE_NAMES) {
      this.db[s] = new Map((rows[s] ?? []).map((o) => [keyOf(s, o), o]));
    }
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #notify() {
    for (const fn of this.listeners) fn();
  }

  get settings() {
    return this.db.meta.get('settings').value;
  }

  meta(key) {
    return this.db.meta.get(key)?.value;
  }

  get foods() { return this.db.foods; }

  get presets() { return this.db.presets; }

  get needsSetup() {
    return !this.meta('initialized') && this.db.foods.size === 0;
  }

  currentDietDay() {
    return dietDayOf(this.now(), this.settings.day_boundary_hour);
  }

  maxDay() {
    const cur = this.currentDietDay();
    const cal = formatLocalDate(this.now());
    return cal > cur ? cal : cur;
  }

  get workingDay() {
    return this.dayOverride ?? this.currentDietDay();
  }

  setWorkingDay(day) {
    if (day > this.maxDay()) throw new Error('不能記到還沒到的日子');
    this.dayOverride = day === this.currentDietDay() ? null : day;
    this.#notify();
  }

  shiftWorkingDay(delta) {
    this.setWorkingDay(addDays(this.workingDay, delta));
  }

  boundaryHint() {
    return boundaryHint(this.now(), this.settings.day_boundary_hour);
  }

  dayRecord(day = this.workingDay) {
    return this.db.days.get(day) ?? newDay(day, this.#goalSettings());
  }

  #goalSettings() {
    return this.settings;
  }

  entriesOf(day = this.workingDay) {
    return [...this.db.entries.values()]
      .filter((e) => e.diet_day === day)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  }

  totals(day = this.workingDay) {
    return dayTotals([...this.db.entries.values()], this.dayRecord(day));
  }

  // 清單用：同一個群組的紀錄收成一組（依群組內第一筆的時間排序）
  listView(day = this.workingDay) {
    const rows = [];
    const groups = new Map();
    for (const e of this.entriesOf(day)) {
      if (!e.group_id) { rows.push({ type: 'entry', entry: e }); continue; }
      let g = groups.get(e.group_id);
      if (!g) {
        g = { type: 'group', group_id: e.group_id, label: e.group_label, preset_id: e.preset_id, entries: [] };
        groups.set(e.group_id, g);
        rows.push(g);
      }
      g.entries.push(e);
    }
    return rows;
  }

  // 快捷卡片。count/total＝今天這個食物被記了多少（含套餐裡的）；removable＝減號真正能扣回的獨立份數。
  quickGrid(day = this.workingDay) {
    const all = [...this.db.entries.values()];
    return this.settings.quick_slots.map((slot) => {
      if (slot.type === 'preset') {
        const p = this.db.presets.get(slot.id);
        if (!p) return { ...slot, missing: true, label: '（已不存在）', count: 0, total: 0, removable: 0 };
        const { groups } = presetUsage(all, p.id, day);
        const t = presetTotals(p, this.db.foods);
        return {
          ...slot, label: p.label, preset: true, count: groups, total: groups, removable: groups,
          fromPreset: 0, fromOther: 0, kcal: t.kcal, archived: p.archived,
        };
      }
      const f = this.db.foods.get(slot.id);
      if (!f) return { ...slot, missing: true, label: '（已不存在）', count: 0, total: 0, removable: 0 };
      const u = foodUsage(all, f.id, day);
      return {
        ...slot, label: f.short_label, opaque: f.kind === 'opaque', count: u.total, total: u.total, removable: u.removable,
        fromPreset: u.fromPreset, fromOther: u.fromOther, kcal: f.kcal_book, needsConfirm: f.needs_confirm, archived: f.archived,
      };
    });
  }

  snapshot() {
    return {
      foods: [...this.db.foods.values()],
      presets: [...this.db.presets.values()],
      days: [...this.db.days.values()],
      entries: [...this.db.entries.values()],
      settings: this.settings,
    };
  }

  // ---- 寫入核心 ----

  #run(fn) {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => {});
    return p;
  }

  #inverse(change) {
    const inv = { put: {}, del: {} };
    const push = (bucket, s, v) => { (inv[bucket][s] ??= []).push(v); };
    for (const [s, objs] of Object.entries(change.put ?? {})) {
      for (const o of objs) {
        const prev = this.db[s].get(keyOf(s, o));
        if (prev) push('put', s, prev);
        else push('del', s, keyOf(s, o));
      }
    }
    for (const [s, keys] of Object.entries(change.del ?? {})) {
      for (const k of keys) {
        const prev = this.db[s].get(k);
        if (prev) push('put', s, prev);
      }
    }
    return inv;
  }

  async #write(change) {
    await this.repo.commit(change);
    for (const [s, keys] of Object.entries(change.del ?? {})) for (const k of keys) this.db[s].delete(k);
    for (const [s, objs] of Object.entries(change.put ?? {})) for (const o of objs) this.db[s].set(keyOf(s, o), o);
  }

  async #apply(change, label = null) {
    const inverse = label ? this.#inverse(change) : null;
    await this.#write(change);
    if (label) this.lastUndo = { id: newId(), label, inverse };
    else this.lastUndo = null;
    this.#notify();
    return this.lastUndo?.id ?? null;
  }

  #dayPut(day) {
    return this.db.days.has(day) ? [] : [newDay(day, this.settings)];
  }

  #entryChange({ put = [], del = [], extra = {} }) {
    const days = new Set(put.map((e) => e.diet_day));
    const dayRows = [...days].flatMap((d) => this.#dayPut(d));
    const change = { put: { entries: put, ...extra.put }, del: { ...(del.length ? { entries: del } : {}), ...extra.del } };
    if (dayRows.length) change.put.days = dayRows;
    return change;
  }

  undoId() {
    return this.lastUndo?.id ?? null;
  }

  undo(id) {
    return this.#run(async () => {
      if (!this.lastUndo || (id && this.lastUndo.id !== id)) return false;
      const { inverse } = this.lastUndo;
      await this.#write(inverse);
      this.lastUndo = null;
      this.#notify();
      return true;
    });
  }

  // ---- 記錄食物 ----

  quickAddFood(foodId, { level = null, qty = 1 } = {}) {
    return this.#run(async () => {
      const food = this.db.foods.get(foodId);
      if (!food) throw new Error('找不到這個食物');
      const now = this.now();
      const dietDay = this.workingDay;
      const last = latestEntry(this.db.entries.values(), dietDay);
      let entry;
      let message;
      if (canMergeQuickTap(last, food, { dietDay, level, now })) {
        entry = withQty(last, last.qty + qty, now);
        message = `已記 ${food.short_label} ×${entry.qty}`;
      } else {
        entry = entryFromFood(food, { dietDay, level, qty, now });
        message = `已記 ${food.short_label}${qty === 1 ? '' : ` ×${qty}`}`;
      }
      const undoId = await this.#apply(this.#entryChange({ put: [entry] }), message);
      return { message, undoId, entryId: entry.id };
    });
  }

  quickAddPreset(presetId) {
    return this.#run(async () => {
      const preset = this.db.presets.get(presetId);
      if (!preset) throw new Error('找不到這個套餐');
      const { entries, warnings } = entriesFromPreset(preset, this.db.foods, { dietDay: this.workingDay, now: this.now() });
      const message = `已記 ${preset.label}（${entries.length} 項）`;
      const undoId = await this.#apply(this.#entryChange({ put: entries }), message);
      return { message, undoId, warnings, groupId: entries[0].group_id };
    });
  }

  addRough({
    kcal, protein = null, name = '', note = null, kcalLow = null, kcalHigh = null, level = null, saveAsQuick = false,
  }) {
    return this.#run(async () => {
      const now = this.now();
      const extra = { put: {} };
      let foodId = null;
      let saved = null;
      if (saveAsQuick) {
        const label = String(name).trim() || '外食粗估';
        const food = {
          id: newFoodId(), short_label: [...label].slice(0, 5).join(''), full_name: label, kind: 'single', unit: '份',
          kcal_book: kcal, kcal_low: null, kcal_high: null, protein_book: protein, source_type: 'rough',
          source_note: `自行粗估（${formatLocalDate(now)}）${note ? `：${note}` : ''}`, needs_confirm: false,
          updated_at: now.toISOString(), archived: false,
        };
        const { errors } = validateFood(food);
        if (errors.length) throw new Error(errors.join('；'));
        foodId = food.id;
        extra.put.foods = [food];
        saved = this.#slotChange({ type: 'food', id: food.id });
        if (saved.change) extra.put.meta = saved.change;
      }
      const entry = roughEntry({
        dietDay: this.workingDay, kcal, protein, name, note, kcalLow, kcalHigh, level, foodId, now,
      });
      const message = `已記 ${entry.label_snapshot}（粗估 ${Math.round(entry.unit_kcal_snapshot)} kcal）`;
      const undoId = await this.#apply(this.#entryChange({ put: [entry], extra }), message);
      return { message, undoId, entryId: entry.id, quickSaved: Boolean(saved?.change), quickFull: Boolean(saveAsQuick && !saved?.change) };
    });
  }

  // 嘗試把食物放進快捷格；已滿就不放（回傳 change=null）
  #slotChange(slot) {
    try {
      const quick_slots = addSlot(this.settings.quick_slots, slot);
      return { change: [{ key: 'settings', value: { ...this.settings, quick_slots } }] };
    } catch {
      return { change: null };
    }
  }

  // ---- 快捷卡片的減號 ----

  // 只減「獨立記下的」食物：最近的一筆減 1 份；份量 ≤ 1 就整筆刪除。套餐裡的組成不受影響。
  decrementFood(foodId) {
    return this.#run(async () => {
      const food = this.db.foods.get(foodId);
      if (!food) throw new Error('找不到這個食物');
      const plan = planDecrementFood([...this.db.entries.values()], foodId, this.workingDay, this.now());
      if (!plan) throw new Error(`今天沒有可以減少的「${food.short_label}」（套餐裡的份數不能用這個減號改）`);
      let change;
      let message;
      if (plan.action === 'delete') {
        change = { del: { entries: [plan.entry.id] } };
        message = `已減 ${food.short_label}（這一筆已拿掉）`;
      } else {
        change = this.#entryChange({ put: [plan.next] });
        message = `已減 ${food.short_label}，剩 ×${plan.next.qty}`;
      }
      const undoId = await this.#apply(change, message);
      return { message, undoId };
    });
  }

  // 減一組套餐：拿掉最近的一整個群組
  decrementPreset(presetId) {
    return this.#run(async () => {
      const preset = this.db.presets.get(presetId);
      if (!preset) throw new Error('找不到這個套餐');
      const plan = planDecrementPreset([...this.db.entries.values()], presetId, this.workingDay);
      if (!plan) throw new Error(`今天沒有可以減少的「${preset.label}」`);
      const message = `已減 ${preset.label}（最近一組，${plan.entries.length} 項）`;
      const undoId = await this.#apply({ del: { entries: plan.entries.map((e) => e.id) } }, message);
      return { message, undoId };
    });
  }

  // ---- 最近／最常吃 ----

  recentItems() {
    return recentAndFrequent({
      entries: [...this.db.entries.values()], foods: this.db.foods, presets: this.db.presets,
      quickSlots: this.settings.quick_slots, today: this.currentDietDay(),
    });
  }

  // ---- 複製以前的餐點 ----

  copyUnits(sourceDay) {
    return selectableUnits([...this.db.entries.values()], sourceDay);
  }

  // 一律用原紀錄的快照複製到「目前正在記的那天」；ids 由呼叫端保存，同一個確認畫面重複送出不會重複記
  copyFromDay({ sourceDay, selection, ids }) {
    return this.#run(async () => {
      const targetDay = this.workingDay;
      const units = selectableUnits([...this.db.entries.values()], sourceDay)
        .filter((u) => selection.some((s) => s.type === u.type && s.id === u.id));
      if (!units.length) throw new Error('沒有選任何項目（或原紀錄已被刪除）');
      const entries = planCopy({ units, targetDay, nowMs: this.now().getTime(), ids });
      const fresh = entries.filter((e) => !this.db.entries.has(e.id));
      if (!fresh.length) return { message: '這些項目已經複製過了', undoId: null, count: 0 };
      const message = `已複製 ${fresh.length} 筆到 ${targetDay}`;
      const undoId = await this.#apply(this.#entryChange({ put: fresh }), message);
      return { message, undoId, count: fresh.length };
    });
  }

  // ---- 從今日已記建立套餐 ----

  // 沒有食物庫對應的紀錄（粗估／GPT 估算）→ 明確存成食物。不會修改原紀錄。
  saveEntryAsFood(entryId) {
    return this.#run(async () => {
      const e = this.db.entries.get(entryId);
      if (!e) throw new Error('找不到這筆紀錄');
      if (e.food_id && this.db.foods.has(e.food_id)) throw new Error('這筆已經有食物庫對應了');
      const food = foodDraftFromEntry(e, { id: newFoodId(), now: this.now() });
      const { errors } = validateFood(food);
      if (errors.length) throw new Error(errors.join('；'));
      const message = `已把「${food.short_label}」存成食物`;
      const undoId = await this.#apply({ put: { foods: [food] } }, message);
      return { message, undoId, foodId: food.id };
    });
  }

  // items 只含食物引用與份量；套餐不另存熱量。不會在今天的帳本新增任何紀錄。
  createPresetFromEntries({ label, items, addToQuick = false }) {
    return this.#run(async () => {
      const name = String(label ?? '').trim();
      if (!name) throw new Error('請輸入套餐名稱');
      const same = findSameName(this.db.presets, name);
      if (same) throw new Error(`已經有同名的套餐「${same.label}」`);
      const dup = findDuplicatePreset(this.db.presets, items);
      if (dup) throw new Error(`已經有相同內容的套餐「${dup.label}」，不重複建立`);
      const preset = {
        id: newPresetId(),
        label: name,
        items: items.map((i) => ({ food_id: i.food_id, qty: i.qty })),
        source_note: '由當日紀錄組成',
        updated_at: this.now().toISOString(),
        archived: false,
      };
      const { errors } = validatePreset(preset, this.db.foods);
      if (errors.length) throw new Error(errors.join('；'));
      const change = { put: { presets: [preset] } };
      let quickFull = false;
      if (addToQuick) {
        try {
          const quick_slots = addSlot(this.settings.quick_slots, { type: 'preset', id: preset.id });
          change.put.meta = [{ key: 'settings', value: { ...this.settings, quick_slots } }];
        } catch { quickFull = true; }
      }
      const message = `已建立套餐「${name}」`;
      const undoId = await this.#apply(change, message);
      return { message, undoId, presetId: preset.id, quickFull };
    });
  }

  // ---- GPT 貼上 ----

  parseGpt(text) {
    const parsed = parseGptText(text);
    const day = this.workingDay;
    const items = markDuplicates(parsed.items, [...this.db.entries.values()], day).map((it) => ({
      ...it,
      entryId: newId(),
      level: it.hasRange ? 'normal' : null,
      selected: !it.duplicate,
      saveAsQuick: false,
    }));
    return { ...parsed, items, dietDay: day };
  }

  // 只有使用者在確認卡上勾選並按「記入今日」的項目才會進來；同一個 entryId 重複送出不會重複記
  commitGpt(items) {
    return this.#run(async () => {
      const now = this.now();
      const dietDay = this.workingDay;
      const fresh = items.filter((it) => !this.db.entries.has(it.entryId));
      if (fresh.length === 0) return { message: '這些項目已經記過了', undoId: null, count: 0 };
      const putEntries = [];
      const putFoods = [];
      let settings = this.settings;
      let quickFull = false;
      for (const it of fresh) {
        if (!it.ok) throw new Error(`「${it.raw}」無法解析，不能記入`);
        let foodId = null;
        if (it.saveAsQuick) {
          const food = foodFromGptItem(it, { now });
          const { errors } = validateFood(food);
          if (errors.length) throw new Error(errors.join('；'));
          putFoods.push(food);
          foodId = food.id;
          try {
            settings = { ...settings, quick_slots: addSlot(settings.quick_slots, { type: 'food', id: food.id }) };
          } catch { quickFull = true; }
        }
        putEntries.push(gptEntry({
          id: it.entryId, dietDay, kcal: it.kcalMid, kcalLow: it.hasRange ? it.kcalLow : null,
          kcalHigh: it.hasRange ? it.kcalHigh : null, level: it.hasRange ? (it.level ?? 'normal') : null,
          protein: it.protein, name: it.name, note: it.note, foodId, gptRawLine: it.raw, now,
        }));
      }
      const extra = { put: {} };
      if (putFoods.length) extra.put.foods = putFoods;
      if (settings !== this.settings) extra.put.meta = [{ key: 'settings', value: settings }];
      const message = `已從 GPT 記入 ${putEntries.length} 項`;
      const undoId = await this.#apply(this.#entryChange({ put: putEntries, extra }), message);
      return { message, undoId, count: putEntries.length, quickFull };
    });
  }

  gptSummary({ question = 'dinner', extra = '' } = {}) {
    const day = this.workingDay;
    return buildSummary({
      now: this.now(), dietDay: day, totals: this.totals(day), entries: [...this.db.entries.values()],
      question, extra, isCurrentDay: day === this.currentDietDay(),
    });
  }

  // ---- 修改既有紀錄 ----

  #entry(id) {
    const e = this.db.entries.get(id);
    if (!e) throw new Error('找不到這筆紀錄（可能已被刪除）');
    return e;
  }

  #edit(id, fn, label) {
    return this.#run(async () => {
      const next = fn(this.#entry(id), this.now());
      const undoId = await this.#apply(this.#entryChange({ put: [next] }), label);
      return { message: label, undoId };
    });
  }

  setEntryQty(id, qty) { return this.#edit(id, (e, now) => withQty(e, qty, now), '已修改份量'); }

  setEntryLevel(id, level) { return this.#edit(id, (e, now) => withLevel(e, level, now), '已修改份量級別'); }

  setEntryValues(id, values) { return this.#edit(id, (e, now) => withValues(e, values, now), '已修改紀錄'); }

  moveEntry(id, day) { return this.#edit(id, (e, now) => withDietDay(e, day, now), `已移到 ${day}`); }

  removeEntry(id) {
    return this.#run(async () => {
      const e = this.#entry(id);
      const undoId = await this.#apply({ del: { entries: [id] } }, `已刪除 ${e.label_snapshot}`);
      return { message: `已刪除 ${e.label_snapshot}`, undoId };
    });
  }

  #groupEntries(groupId) {
    const list = [...this.db.entries.values()].filter((e) => e.group_id === groupId);
    if (!list.length) throw new Error('找不到這個套餐組（可能已被刪除）');
    return list;
  }

  removeGroup(groupId) {
    return this.#run(async () => {
      const list = this.#groupEntries(groupId);
      const label = `已刪除 ${list[0].group_label}（${list.length} 項）`;
      const undoId = await this.#apply({ del: { entries: list.map((e) => e.id) } }, label);
      return { message: label, undoId };
    });
  }

  moveGroup(groupId, day) {
    return this.#run(async () => {
      const now = this.now();
      const list = this.#groupEntries(groupId).map((e) => withDietDay(e, day, now));
      const label = `已把 ${list[0].group_label} 移到 ${day}`;
      const undoId = await this.#apply(this.#entryChange({ put: list }), label);
      return { message: label, undoId };
    });
  }

  // ---- 食物庫與快捷格 ----

  saveFood(food) {
    return this.#run(async () => {
      const { errors } = validateFood(food);
      if (errors.length) throw new Error(errors.join('；'));
      await this.#apply({ put: { foods: [food] } });
      return { message: `已儲存 ${food.short_label}` };
    });
  }

  archiveFood(id, archived) {
    return this.#run(async () => {
      const food = this.db.foods.get(id);
      if (!food) throw new Error('找不到這個食物');
      const change = { put: { foods: [{ ...food, archived, updated_at: this.now().toISOString() }] } };
      if (archived) {
        const quick_slots = removeSlot(this.settings.quick_slots, { type: 'food', id });
        change.put.meta = [{ key: 'settings', value: { ...this.settings, quick_slots } }];
      }
      await this.#apply(change);
      return { message: archived ? `已封存 ${food.short_label}` : `已還原 ${food.short_label}` };
    });
  }

  foodReferences(id) {
    return foodReferences(id, this.db.presets, this.settings);
  }

  savePreset(preset) {
    return this.#run(async () => {
      const { errors } = validatePreset(preset, this.db.foods);
      if (errors.length) throw new Error(errors.join('；'));
      await this.#apply({ put: { presets: [preset] } });
      return { message: `已儲存 ${preset.label}` };
    });
  }

  archivePreset(id, archived) {
    return this.#run(async () => {
      const preset = this.db.presets.get(id);
      if (!preset) throw new Error('找不到這個套餐');
      const change = { put: { presets: [{ ...preset, archived, updated_at: this.now().toISOString() }] } };
      if (archived) {
        const quick_slots = removeSlot(this.settings.quick_slots, { type: 'preset', id });
        change.put.meta = [{ key: 'settings', value: { ...this.settings, quick_slots } }];
      }
      await this.#apply(change);
      return { message: archived ? `已封存 ${preset.label}` : `已還原 ${preset.label}` };
    });
  }

  #saveSlots(quick_slots) {
    return this.#apply({ put: { meta: [{ key: 'settings', value: { ...this.settings, quick_slots } }] } });
  }

  addQuickSlot(slot) {
    return this.#run(async () => {
      await this.#saveSlots(addSlot(this.settings.quick_slots, slot));
      return { message: '已加入快捷格' };
    });
  }

  removeQuickSlot(slot) {
    return this.#run(async () => {
      await this.#saveSlots(removeSlot(this.settings.quick_slots, slot));
      return { message: '已從快捷格移除' };
    });
  }

  moveQuickSlot(index, delta) {
    return this.#run(async () => {
      await this.#saveSlots(moveSlot(this.settings.quick_slots, index, delta));
      return { message: '已調整順序' };
    });
  }

  // ---- 設定 ----

  saveSettings({ kcal_goal_default, protein_goal_default, day_boundary_hour }, { applyToToday = true } = {}) {
    return this.#run(async () => {
      const next = {
        ...this.settings, kcal_goal_default, protein_goal_default, day_boundary_hour,
      };
      // 先用同一套檢查驗證，錯誤會在寫入前丟出
      newDay('2000-01-01', next);
      if (!Number.isInteger(day_boundary_hour) || day_boundary_hour < 0 || day_boundary_hour > 12) {
        throw new Error('換日時間必須是 0–12 的整數小時');
      }
      const change = { put: { meta: [{ key: 'settings', value: next }] } };
      if (applyToToday) {
        const today = dietDayOf(this.now(), day_boundary_hour);
        change.put.days = [withGoals(this.db.days.get(today) ?? newDay(today, next), {
          kcalGoal: kcal_goal_default, proteinGoal: protein_goal_default,
        })];
      }
      await this.#apply(change);
      return { message: '設定已儲存' };
    });
  }

  // ---- 備份與匯入 ----

  buildBackupDoc(scope = 'full') {
    return buildBackup(this.snapshot(), { now: this.now(), scope });
  }

  // 匯出時順便記下「最後備份時間」；備份檔裡的設定也帶著這個時間
  exportBackup(scope = 'full') {
    return this.#run(async () => {
      const at = this.now().toISOString();
      if (scope === 'full') {
        await this.#apply({ put: { meta: [{ key: 'settings', value: { ...this.settings, last_export_at: at } }] } });
      }
      const doc = this.buildBackupDoc(scope);
      return { doc, text: serializeBackup(doc), at };
    });
  }

  planImport(doc, mode, opts) {
    return planImport(this.snapshot(), doc, mode, opts);
  }

  // 套用已通過檢查的匯入計畫。完整取代用單一交易；套用前先把目前資料存成一份「匯入前快照」。
  applyImport(plan) {
    return this.#run(async () => {
      if (!plan?.ok) throw new Error('這份資料沒有通過檢查，不能匯入');
      const before = { key: 'pre_import_snapshot', value: { at: this.now().toISOString(), doc: this.buildBackupDoc('full') } };
      const settings = { key: 'settings', value: plan.result.settings };
      const initialized = { key: 'initialized', value: true };
      if (plan.mode === 'replace_all') {
        const rows = {
          foods: plan.result.foods,
          presets: plan.result.presets,
          days: plan.result.days,
          entries: plan.result.entries,
          meta: [
            settings, initialized, before,
            { key: 'schema_version', value: SCHEMA_VERSION },
            { key: 'first_use_at', value: this.meta('first_use_at') ?? this.now().toISOString() },
          ],
        };
        await this.repo.replaceAll(rows);
        this.#fill(rows);
      } else {
        await this.#write({
          put: {
            foods: plan.result.foods.filter((f) => this.db.foods.get(f.id) !== f && JSON.stringify(this.db.foods.get(f.id)) !== JSON.stringify(f)),
            presets: plan.result.presets.filter((p) => JSON.stringify(this.db.presets.get(p.id)) !== JSON.stringify(p)),
            meta: [settings, initialized, before],
          },
        });
      }
      this.lastUndo = null;
      this.dayOverride = null;
      this.#notify();
      return { message: plan.mode === 'replace_all' ? '已完整還原' : '已匯入食物庫' };
    });
  }

  get hasPreImportSnapshot() {
    return Boolean(this.meta('pre_import_snapshot'));
  }

  get preImportSnapshotAt() {
    return this.meta('pre_import_snapshot')?.at ?? null;
  }

  restorePreImport() {
    const snap = this.meta('pre_import_snapshot');
    if (!snap) return Promise.reject(new Error('沒有可復原的匯入前資料'));
    const plan = this.planImport(snap.doc, 'replace_all');
    return this.applyImport(plan);
  }

  startBlank() {
    return this.#run(async () => {
      await this.#apply({ put: { meta: [{ key: 'initialized', value: true }] } });
      return { message: '已用空白食物庫開始' };
    });
  }

  // 備份提醒：從沒備份過、或超過 7 天；「稍後」可延後一天
  backupReminder() {
    if (!this.meta('initialized')) return null;
    const now = this.now().getTime();
    const snooze = this.meta('backup_snooze_until');
    if (snooze && now < Date.parse(snooze)) return null;
    const last = this.settings.last_export_at;
    if (!last) return { kind: 'never' };
    const days = Math.floor((now - Date.parse(last)) / DAY_MS);
    return days >= BACKUP_STALE_DAYS ? { kind: 'stale', days } : null;
  }

  snoozeBackupReminder(days = 1) {
    return this.#run(async () => {
      const until = new Date(this.now().getTime() + days * DAY_MS).toISOString();
      await this.#apply({ put: { meta: [{ key: 'backup_snooze_until', value: until }] } });
    });
  }

  get version() { return APP_VERSION; }
}
