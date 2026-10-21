// 食物庫與快捷格的管理規則（純函式）。
import { MAX_QUICK_SLOTS, SOURCE_TYPES } from './constants.js';
import { newId } from './ids.js';
import { validateFood, validatePreset } from './validate.js';

export function newFoodId() {
  return `f_${newId().slice(0, 8)}`;
}

export function newPresetId() {
  return `p_${newId().slice(0, 8)}`;
}

const numOrNull = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
};

// 表單 → Food。回傳 { food, errors }。蛋白質留空 = 未知（null）。
export function foodFromForm(form, existing = null, now = new Date()) {
  const kind = form.kind === 'opaque' ? 'opaque' : 'single';
  const kcal = numOrNull(form.kcal_book);
  const food = {
    id: existing?.id ?? newFoodId(),
    short_label: String(form.short_label ?? '').trim(),
    full_name: String(form.full_name ?? '').trim() || String(form.short_label ?? '').trim(),
    kind,
    unit: String(form.unit ?? '').trim() || '份',
    kcal_book: kcal,
    kcal_low: kind === 'opaque' ? numOrNull(form.kcal_low) : null,
    kcal_high: kind === 'opaque' ? numOrNull(form.kcal_high) : null,
    protein_book: numOrNull(form.protein_book),
    source_type: SOURCE_TYPES.includes(form.source_type) ? form.source_type : 'rough',
    source_note: String(form.source_note ?? '').trim() || '使用者自行輸入',
    needs_confirm: Boolean(form.needs_confirm),
    updated_at: now.toISOString(),
    archived: existing?.archived ?? false,
  };
  if (existing?.legacy_ids) food.legacy_ids = existing.legacy_ids;
  const { errors } = validateFood(food);
  return { food, errors };
}

export function presetFromForm(form, existing = null, foodsById, now = new Date()) {
  const items = (form.items ?? [])
    .map((i) => ({ food_id: i.food_id, qty: Number(i.qty) }))
    .filter((i) => i.food_id);
  const preset = {
    id: existing?.id ?? newPresetId(),
    label: String(form.label ?? '').trim(),
    items,
    source_note: String(form.source_note ?? '').trim() || '使用者自行建立',
    updated_at: now.toISOString(),
    archived: existing?.archived ?? false,
  };
  const { errors } = validatePreset(preset, foodsById);
  return { preset, errors };
}

// 封存會影響哪些地方：套餐裡引用它、快捷格裡放著它
export function foodReferences(foodId, presets, settings) {
  return {
    presets: [...presets.values()].filter((p) => !p.archived && p.items.some((i) => i.food_id === foodId)),
    inQuickSlots: settings.quick_slots.some((s) => s.type === 'food' && s.id === foodId),
  };
}

export function slotKey(slot) {
  return `${slot.type}:${slot.id}`;
}

export function addSlot(slots, slot) {
  if (slots.some((s) => slotKey(s) === slotKey(slot))) throw new Error('這一項已在快捷格');
  if (slots.length >= MAX_QUICK_SLOTS) throw new Error(`快捷格已滿（最多 ${MAX_QUICK_SLOTS} 格）`);
  return [...slots, { type: slot.type, id: slot.id }];
}

export function removeSlot(slots, slot) {
  return slots.filter((s) => slotKey(s) !== slotKey(slot));
}

export function moveSlot(slots, index, delta) {
  const j = index + delta;
  if (index < 0 || index >= slots.length || j < 0 || j >= slots.length) return slots;
  const next = [...slots];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

// 從 GPT 貼入的項目存成食物：有範圍 → 整餐模板（可選偏少／一般／偏多）；單一數字 → 單品
export function foodFromGptItem(item, { id, now = new Date() } = {}) {
  const opaque = item.hasRange;
  const food = {
    id: id ?? newFoodId(),
    short_label: [...item.name].slice(0, 5).join(''),
    full_name: item.name,
    kind: opaque ? 'opaque' : 'single',
    unit: '份',
    kcal_book: opaque ? item.kcalMid : item.kcalLow,
    kcal_low: opaque ? item.kcalLow : null,
    kcal_high: opaque ? item.kcalHigh : null,
    protein_book: item.protein,
    source_type: 'gpt_estimate',
    source_note: `GPT 估算（${now.toISOString().slice(0, 10)}）：${item.raw}`,
    needs_confirm: false,
    updated_at: now.toISOString(),
    archived: false,
  };
  return food;
}
