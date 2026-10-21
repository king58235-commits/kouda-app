// 食物庫／種子／備份檔的檢查。errors 會擋下匯入；warnings 只提醒。
import {
  BACKUP_FORMAT, BACKUP_SCOPES, FOOD_KINDS, LEVELS, MAX_BOUNDARY_HOUR, MAX_QUICK_SLOTS,
  ORIGINS, QUICK_SLOT_TYPES, SCHEMA_VERSION, SOURCE_TYPES,
} from './constants.js';
import { isDayString } from './day.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const isTime = (x) => typeof x === 'string' && !Number.isNaN(Date.parse(x));

// 套餐的總數一律由單品現算，不允許另外存一份
const PRESET_FORBIDDEN_KEYS = [
  'kcal', 'kcal_book', 'kcal_min', 'kcal_max', 'kcal_low', 'kcal_high',
  'protein', 'protein_book', 'protein_min', 'protein_max',
];

const MAX_LABEL_CHARS = 5;

export function validateFood(f) {
  const errors = [];
  const warnings = [];
  const who = `食物 ${f?.id ?? '（沒有 id）'}`;
  if (!f || typeof f !== 'object') return { errors: [`${who}：不是物件`], warnings };

  if (!isText(f.id)) errors.push(`${who}：缺少 id`);
  for (const k of ['short_label', 'full_name', 'unit', 'source_note']) {
    if (!isText(f[k])) errors.push(`${who}：缺少 ${k}`);
  }
  if (!FOOD_KINDS.includes(f.kind)) errors.push(`${who}：kind 必須是 ${FOOD_KINDS.join('／')}`);
  if (!SOURCE_TYPES.includes(f.source_type)) errors.push(`${who}：source_type 必須是 ${SOURCE_TYPES.join('／')}`);

  if (!isNum(f.kcal_book) || f.kcal_book < 0) errors.push(`${who}：kcal_book 必須是 0 以上的數字`);
  for (const k of ['kcal_low', 'kcal_high']) {
    if (f[k] != null && (!isNum(f[k]) || f[k] < 0)) errors.push(`${who}：${k} 必須是 0 以上的數字或 null`);
  }
  if (f.kind === 'opaque' && (f.kcal_low == null || f.kcal_high == null)) {
    errors.push(`${who}：整餐模板必須有 kcal_low（偏少）與 kcal_high（偏多）`);
  }
  if (isNum(f.kcal_low) && isNum(f.kcal_book) && f.kcal_low > f.kcal_book) errors.push(`${who}：kcal_low 大於 kcal_book`);
  if (isNum(f.kcal_high) && isNum(f.kcal_book) && f.kcal_high < f.kcal_book) errors.push(`${who}：kcal_high 小於 kcal_book`);

  if (!('protein_book' in f)) {
    errors.push(`${who}：必須寫出 protein_book；未知請寫 null，不能省略`);
  } else if (f.protein_book !== null && (!isNum(f.protein_book) || f.protein_book < 0)) {
    errors.push(`${who}：protein_book 必須是 0 以上的數字或 null`);
  } else if (f.protein_book === 0) {
    warnings.push(`${who}：蛋白質為 0，請確認不是「未知」（未知要寫 null）`);
  }

  if (f.needs_confirm !== undefined && typeof f.needs_confirm !== 'boolean') errors.push(`${who}：needs_confirm 必須是 true／false`);
  if (typeof f.archived !== 'boolean') errors.push(`${who}：archived 必須是 true／false`);
  if (!isTime(f.updated_at)) errors.push(`${who}：updated_at 不是有效時間`);
  if (isText(f.short_label) && [...f.short_label].length > MAX_LABEL_CHARS) {
    warnings.push(`${who}：按鈕名稱「${f.short_label}」超過 ${MAX_LABEL_CHARS} 個字，手機上可能被截斷`);
  }
  return { errors, warnings };
}

export function validatePreset(p, foodsById) {
  const errors = [];
  const warnings = [];
  const who = `套餐 ${p?.id ?? '（沒有 id）'}`;
  if (!p || typeof p !== 'object') return { errors: [`${who}：不是物件`], warnings };

  if (!isText(p.id)) errors.push(`${who}：缺少 id`);
  if (!isText(p.label)) errors.push(`${who}：缺少 label`);
  for (const k of PRESET_FORBIDDEN_KEYS) {
    if (k in p) errors.push(`${who}：不可存 ${k}；套餐總數一律由單品現算`);
  }
  if (!Array.isArray(p.items) || p.items.length === 0) {
    errors.push(`${who}：items 至少要有一項`);
  } else {
    p.items.forEach((item, i) => {
      const food = foodsById.get(item?.food_id);
      if (!food) errors.push(`${who}：第 ${i + 1} 項引用了不存在的食物 ${item?.food_id}`);
      else if (food.archived) warnings.push(`${who}：第 ${i + 1} 項「${food.short_label}」已封存`);
      if (!isNum(item?.qty) || item.qty <= 0) errors.push(`${who}：第 ${i + 1} 項份量必須大於 0`);
    });
  }
  if (typeof p.archived !== 'boolean') errors.push(`${who}：archived 必須是 true／false`);
  if (!isTime(p.updated_at)) errors.push(`${who}：updated_at 不是有效時間`);
  return { errors, warnings };
}

export function validateSettings(s, foodsById, presetsById) {
  const errors = [];
  const warnings = [];
  if (!s || typeof s !== 'object') return { errors: ['設定：不是物件'], warnings };

  if (!isNum(s.kcal_goal_default) || s.kcal_goal_default <= 0) errors.push('設定：kcal_goal_default 必須大於 0');
  if (!isNum(s.protein_goal_default) || s.protein_goal_default < 0) errors.push('設定：protein_goal_default 必須是 0 以上');
  if (!Number.isInteger(s.day_boundary_hour) || s.day_boundary_hour < 0 || s.day_boundary_hour > MAX_BOUNDARY_HOUR) {
    errors.push(`設定：day_boundary_hour 必須是 0–${MAX_BOUNDARY_HOUR} 的整數`);
  }

  if (!Array.isArray(s.quick_slots)) {
    errors.push('設定：quick_slots 必須是清單');
  } else {
    if (s.quick_slots.length > MAX_QUICK_SLOTS) errors.push(`設定：快捷格最多 ${MAX_QUICK_SLOTS} 格，現在 ${s.quick_slots.length} 格`);
    const seen = new Set();
    s.quick_slots.forEach((slot, i) => {
      const where = `設定：快捷格第 ${i + 1} 格`;
      if (!QUICK_SLOT_TYPES.includes(slot?.type)) {
        errors.push(`${where} type 必須是 ${QUICK_SLOT_TYPES.join('／')}`);
        return;
      }
      const key = `${slot.type}:${slot.id}`;
      if (seen.has(key)) errors.push(`${where} 重複：${slot.id}`);
      seen.add(key);
      const target = (slot.type === 'food' ? foodsById : presetsById).get(slot.id);
      if (!target) errors.push(`${where} 找不到 ${slot.type} ${slot.id}`);
      else if (target.archived) warnings.push(`${where}「${target.short_label ?? target.label}」已封存`);
    });
  }
  return { errors, warnings };
}

function collectIds(list, kind, errors) {
  const map = new Map();
  for (const x of list) {
    if (!isText(x?.id)) continue;
    if (map.has(x.id)) errors.push(`${kind} id 重複：${x.id}`);
    map.set(x.id, x);
  }
  return map;
}

export function validateLibraryDoc(doc) {
  const errors = [];
  const warnings = [];
  if (!doc || typeof doc !== 'object') return { errors: ['檔案內容不是 JSON 物件'], warnings };
  if (doc.format !== BACKUP_FORMAT) errors.push(`format 必須是「${BACKUP_FORMAT}」`);
  if (doc.schema_version !== SCHEMA_VERSION) {
    errors.push(doc.schema_version > SCHEMA_VERSION
      ? `檔案來自較新版本（schema ${doc.schema_version}），請先更新 App`
      : `不支援的 schema_version：${doc.schema_version}`);
  }
  if (!BACKUP_SCOPES.includes(doc.scope)) errors.push(`scope 必須是 ${BACKUP_SCOPES.join('／')}`);
  if (!Array.isArray(doc.foods)) errors.push('foods 必須是清單');
  if (!Array.isArray(doc.presets)) errors.push('presets 必須是清單');
  if (errors.length) return { errors, warnings };

  const foodsById = collectIds(doc.foods, '食物', errors);
  const presetsById = collectIds(doc.presets, '套餐', errors);
  for (const id of presetsById.keys()) {
    if (foodsById.has(id)) errors.push(`食物與套餐使用了相同 id：${id}`);
  }
  const merge = (r) => { errors.push(...r.errors); warnings.push(...r.warnings); };
  doc.foods.forEach((f) => merge(validateFood(f)));
  doc.presets.forEach((p) => merge(validatePreset(p, foodsById)));
  if (doc.settings !== undefined) merge(validateSettings(doc.settings, foodsById, presetsById));
  return { errors, warnings };
}

// ---- 完整備份才有的：每日目標（Day）與紀錄（Entry）----

export function validateDayRecord(d) {
  const errors = [];
  const who = `飲食日 ${d?.diet_day ?? '（沒有日期）'}`;
  if (!d || typeof d !== 'object') return { errors: [`${who}：不是物件`], warnings: [] };
  if (!isDayString(d.diet_day)) errors.push(`${who}：diet_day 格式錯誤`);
  if (!isNum(d.kcal_goal) || d.kcal_goal <= 0) errors.push(`${who}：kcal_goal 必須大於 0`);
  if (!isNum(d.protein_goal) || d.protein_goal < 0) errors.push(`${who}：protein_goal 必須是 0 以上`);
  return { errors, warnings: [] };
}

export function validateEntry(e) {
  const errors = [];
  const warnings = [];
  const who = `紀錄 ${e?.id ?? '（沒有 id）'}`;
  if (!e || typeof e !== 'object') return { errors: [`${who}：不是物件`], warnings };
  if (!isText(e.id)) errors.push(`${who}：缺少 id`);
  if (!isDayString(e.diet_day)) errors.push(`${who}：diet_day 格式錯誤`);
  if (!isTime(e.created_at) || !isTime(e.updated_at)) errors.push(`${who}：時間格式錯誤`);
  if (!ORIGINS.includes(e.origin)) errors.push(`${who}：origin 錯誤`);
  if (!isNum(e.qty) || e.qty <= 0) errors.push(`${who}：份量必須大於 0`);
  if (!isText(e.name_snapshot) || !isText(e.label_snapshot)) errors.push(`${who}：缺少名稱快照`);
  if (!isNum(e.unit_kcal_snapshot) || e.unit_kcal_snapshot < 0) errors.push(`${who}：unit_kcal_snapshot 錯誤`);
  if (e.unit_protein_snapshot !== null && (!isNum(e.unit_protein_snapshot) || e.unit_protein_snapshot < 0)) {
    errors.push(`${who}：unit_protein_snapshot 必須是 0 以上或 null`);
  }
  if (!('unit_protein_snapshot' in e)) errors.push(`${who}：必須寫出 unit_protein_snapshot（未知請寫 null）`);
  if (!SOURCE_TYPES.includes(e.source_type_snapshot)) errors.push(`${who}：source_type_snapshot 錯誤`);
  if (e.level !== null && e.level !== undefined && !LEVELS.includes(e.level)) errors.push(`${who}：level 錯誤`);
  if ((e.group_id == null) !== (e.group_label == null)) errors.push(`${who}：group_id 與 group_label 必須同時存在或同時為空`);
  for (const k of ['unit_kcal_low_snapshot', 'unit_kcal_mid_snapshot', 'unit_kcal_high_snapshot']) {
    if (e[k] != null && (!isNum(e[k]) || e[k] < 0)) errors.push(`${who}：${k} 錯誤`);
  }
  if (isNum(e.unit_kcal_low_snapshot) && isNum(e.unit_kcal_high_snapshot) && e.unit_kcal_low_snapshot > e.unit_kcal_high_snapshot) {
    errors.push(`${who}：熱量範圍上下限顛倒`);
  }
  return { errors, warnings };
}

export function validateFullDoc(doc) {
  const base = validateLibraryDoc(doc);
  const errors = [...base.errors];
  const warnings = [...base.warnings];
  if (errors.length) return { errors, warnings };
  if (doc.scope !== 'full') errors.push('這不是完整備份（scope 必須是 full）');
  if (!Array.isArray(doc.days)) errors.push('days 必須是清單');
  if (!Array.isArray(doc.entries)) errors.push('entries 必須是清單');
  if (doc.settings === undefined) errors.push('完整備份必須包含 settings');
  if (errors.length) return { errors, warnings };

  const dayKeys = new Set();
  for (const d of doc.days) {
    const r = validateDayRecord(d);
    errors.push(...r.errors);
    if (dayKeys.has(d?.diet_day)) errors.push(`飲食日重複：${d.diet_day}`);
    dayKeys.add(d?.diet_day);
  }
  const ids = new Set();
  for (const e of doc.entries) {
    const r = validateEntry(e);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    if (ids.has(e?.id)) errors.push(`紀錄 id 重複：${e.id}`);
    ids.add(e?.id);
    if (isDayString(e?.diet_day) && !dayKeys.has(e.diet_day)) {
      warnings.push(`${e.diet_day} 有紀錄但沒有當日目標，將使用目前預設目標顯示`);
    }
  }
  return { errors, warnings };
}
