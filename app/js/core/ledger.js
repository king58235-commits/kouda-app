// 帳本：建立與修改紀錄（Entry）。
// 規則：紀錄建立時複製食物當下的數值（快照），之後改食物庫不會改到已記的紀錄；
// 套餐只是「一次加入多筆」的捷徑，套餐本身從不成為一筆紀錄。
import { LEVELS, ORIGINS } from './constants.js';
import { isDayString } from './day.js';
import { newId } from './ids.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export const MERGE_WINDOW_MS = 8000;

export function indexById(list) {
  return new Map(list.map((x) => [x.id, x]));
}

function assertQty(qty) {
  if (!isNum(qty) || qty <= 0) throw new Error(`份量必須大於 0：${qty}`);
}

function assertDay(dietDay) {
  if (!isDayString(dietDay)) throw new Error(`飲食日格式錯誤：${dietDay}`);
}

function assertNonNegative(x, what) {
  if (!isNum(x) || x < 0) throw new Error(`${what}必須是 0 以上的數字：${x}`);
}

function iso(now) {
  return (now ?? new Date()).toISOString();
}

export function pickLevelKcal({ low, mid, high }, level) {
  if (!LEVELS.includes(level)) throw new Error(`份量級別錯誤：${level}`);
  if (level === 'low') return low;
  if (level === 'high') return high;
  return mid;
}

export function entryFromFood(food, {
  dietDay, qty = 1, level = null, origin = 'food',
  groupId = null, groupLabel = null, presetId = null, id, now,
} = {}) {
  assertQty(qty);
  assertDay(dietDay);
  if (!ORIGINS.includes(origin)) throw new Error(`來源錯誤：${origin}`);

  let unitKcal = food.kcal_book;
  let chosenLevel = null;
  let mid = null;
  if (food.kind === 'opaque') {
    chosenLevel = level ?? 'normal';
    mid = food.kcal_book;
    unitKcal = pickLevelKcal({ low: food.kcal_low, mid, high: food.kcal_high }, chosenLevel);
  } else if (level != null) {
    throw new Error(`「${food.short_label}」不是整餐模板，不能選份量級別`);
  }

  const t = iso(now);
  return {
    id: id ?? newId(),
    diet_day: dietDay,
    created_at: t,
    updated_at: t,
    origin,
    food_id: food.id,
    preset_id: presetId,
    group_id: groupId,
    group_label: groupLabel,
    name_snapshot: food.full_name,
    label_snapshot: food.short_label,
    unit_snapshot: food.unit,
    qty,
    level: chosenLevel,
    unit_kcal_snapshot: unitKcal,
    unit_kcal_low_snapshot: food.kind === 'opaque' ? food.kcal_low : null,
    unit_kcal_mid_snapshot: mid,
    unit_kcal_high_snapshot: food.kind === 'opaque' ? food.kcal_high : null,
    unit_protein_snapshot: food.protein_book ?? null,
    source_type_snapshot: food.source_type,
    source_note_snapshot: food.source_note ?? null,
    needs_confirm_snapshot: Boolean(food.needs_confirm),
    note: null,
    gpt_raw_line: null,
  };
}

export function entriesFromPreset(preset, foodsById, { dietDay, now, groupId, makeId = newId } = {}) {
  if (!Array.isArray(preset.items) || preset.items.length === 0) {
    throw new Error(`套餐「${preset.label}」沒有任何組成`);
  }
  const gid = groupId ?? makeId();
  const warnings = [];
  const base = (now ?? new Date()).getTime();
  // 每一項差 1 毫秒，讓清單裡的順序永遠和套餐裡的順序一致
  const entries = preset.items.map((item, i) => {
    const food = foodsById.get(item.food_id);
    if (!food) throw new Error(`套餐「${preset.label}」引用了不存在的食物：${item.food_id}`);
    if (food.archived) warnings.push(`套餐「${preset.label}」含已封存的食物：${food.short_label}`);
    return entryFromFood(food, {
      dietDay, qty: item.qty, origin: 'preset',
      groupId: gid, groupLabel: preset.label, presetId: preset.id, id: makeId(), now: new Date(base + i),
    });
  });
  return { entries, warnings };
}

// 沒有食物庫對應的紀錄：外食粗估（origin=rough）或從 GPT 貼入（origin=gpt）。
// 只需要熱量；蛋白質未知就是 null，不是 0。
// kcal 是「一般」（單一數字或範圍中點）；有範圍時 level 決定實際採用 low／mid／high。
export function freeEntry({
  origin = 'rough', dietDay, kcal, protein = null, name = '外食粗估',
  kcalLow = null, kcalHigh = null, level = null, note = null, foodId = null,
  gptRawLine = null, id, now,
} = {}) {
  if (origin !== 'rough' && origin !== 'gpt') throw new Error(`自由紀錄的來源只能是 rough 或 gpt：${origin}`);
  assertDay(dietDay);
  assertNonNegative(kcal, '熱量');
  if (protein !== null) assertNonNegative(protein, '蛋白質');
  const hasRange = kcalLow !== null || kcalHigh !== null;
  let unit = kcal;
  let chosen = null;
  if (hasRange) {
    if (kcalLow === null || kcalHigh === null) throw new Error('熱量範圍必須同時有下限與上限');
    assertNonNegative(kcalLow, '熱量下限');
    assertNonNegative(kcalHigh, '熱量上限');
    if (kcalLow > kcal || kcal > kcalHigh) throw new Error(`熱量 ${kcal} 不在範圍 ${kcalLow}–${kcalHigh} 之內`);
    chosen = level ?? 'normal';
    unit = pickLevelKcal({ low: kcalLow, mid: kcal, high: kcalHigh }, chosen);
  } else if (level !== null) {
    throw new Error('沒有熱量範圍，不能選份量級別');
  }
  const label = String(name ?? '').trim() || '外食粗估';
  const t = iso(now);
  return {
    id: id ?? newId(),
    diet_day: dietDay,
    created_at: t,
    updated_at: t,
    origin,
    food_id: foodId,
    preset_id: null,
    group_id: null,
    group_label: null,
    name_snapshot: label,
    label_snapshot: label,
    unit_snapshot: '份',
    qty: 1,
    level: chosen,
    unit_kcal_snapshot: unit,
    unit_kcal_low_snapshot: hasRange ? kcalLow : null,
    unit_kcal_mid_snapshot: hasRange ? kcal : null,
    unit_kcal_high_snapshot: hasRange ? kcalHigh : null,
    unit_protein_snapshot: protein,
    source_type_snapshot: origin === 'gpt' ? 'gpt_estimate' : 'rough',
    source_note_snapshot: null,
    needs_confirm_snapshot: false,
    note: note && String(note).trim() ? String(note).trim() : null,
    gpt_raw_line: gptRawLine,
  };
}

export const roughEntry = (opts) => freeEntry({ ...opts, origin: 'rough' });
export const gptEntry = (opts) => freeEntry({ ...opts, origin: 'gpt' });

export function withQty(entry, qty, now) {
  assertQty(qty);
  return { ...entry, qty, updated_at: iso(now) };
}

export function withDietDay(entry, dietDay, now) {
  assertDay(dietDay);
  return { ...entry, diet_day: dietDay, updated_at: iso(now) };
}

export function hasLevels(entry) {
  return entry.unit_kcal_low_snapshot != null
    && entry.unit_kcal_mid_snapshot != null
    && entry.unit_kcal_high_snapshot != null;
}

// 只有帶三級熱量快照的紀錄（整餐模板、有範圍的粗估／GPT）能改級別；數值取自當初的快照，不重新讀食物庫
export function withLevel(entry, level, now) {
  if (!hasLevels(entry)) throw new Error(`「${entry.label_snapshot}」沒有份量級別可選`);
  const kcal = pickLevelKcal({
    low: entry.unit_kcal_low_snapshot,
    mid: entry.unit_kcal_mid_snapshot,
    high: entry.unit_kcal_high_snapshot,
  }, level);
  return { ...entry, level, unit_kcal_snapshot: kcal, updated_at: iso(now) };
}

// 直接修改粗估／GPT 紀錄的數值（食物庫來源的紀錄不開放，避免快照被悄悄改寫）。
// 改了熱量就視為重新輸入：清掉範圍與級別。
export function withValues(entry, { name, kcal, protein, note }, now) {
  if (entry.origin !== 'rough' && entry.origin !== 'gpt') {
    throw new Error('只有粗估或 GPT 貼入的紀錄可以直接修改數值');
  }
  const next = { ...entry, updated_at: iso(now) };
  if (name !== undefined) {
    const label = String(name).trim();
    if (!label) throw new Error('名稱不能是空白');
    next.name_snapshot = label;
    next.label_snapshot = label;
  }
  if (kcal !== undefined) {
    assertNonNegative(kcal, '熱量');
    next.unit_kcal_snapshot = kcal;
    next.unit_kcal_low_snapshot = null;
    next.unit_kcal_mid_snapshot = null;
    next.unit_kcal_high_snapshot = null;
    next.level = null;
  }
  if (protein !== undefined) {
    if (protein !== null) assertNonNegative(protein, '蛋白質');
    next.unit_protein_snapshot = protein;
  }
  if (note !== undefined) next.note = note && String(note).trim() ? String(note).trim() : null;
  return next;
}

// 快捷鍵連點：短時間內再點同一個食物，視為同一筆加份數（清單不會出現一排重複列）
export function canMergeQuickTap(last, food, { dietDay, level = null, now }) {
  if (!last) return false;
  if (last.origin !== 'food' || last.group_id) return false;
  if (last.food_id !== food.id || last.diet_day !== dietDay) return false;
  if ((last.level ?? null) !== (food.kind === 'opaque' ? (level ?? 'normal') : null)) return false;
  return now.getTime() - Date.parse(last.updated_at) <= MERGE_WINDOW_MS;
}

export function latestEntry(entries, dietDay) {
  let best = null;
  for (const e of entries) {
    if (e.diet_day !== dietDay) continue;
    if (!best || e.created_at > best.created_at) best = e;
  }
  return best;
}

export function removeEntry(entries, entryId) {
  return entries.filter((e) => e.id !== entryId);
}

export function removeGroup(entries, groupId) {
  if (!groupId) throw new Error('缺少群組 id');
  return entries.filter((e) => e.group_id !== groupId);
}

export function moveGroup(entries, groupId, dietDay, now) {
  if (!groupId) throw new Error('缺少群組 id');
  return entries.map((e) => (e.group_id === groupId ? withDietDay(e, dietDay, now) : e));
}
