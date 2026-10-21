// 從今日已記的內容組成新套餐。
// 套餐只存「食物引用＋份量」，不存熱量；所以只有帶有效 food_id 的紀錄能直接加入。
// 粗估／GPT 估算若沒有食物庫對應，要先明確「存成食物」。
import { normalizeQuery } from './search.js';

const round2 = (x) => Math.round(x * 100) / 100;

// 每一筆紀錄能不能加進套餐，不能的話原因是什麼
export function classifyEntries(entries, foodsById) {
  return entries.map((entry) => {
    if (!entry.food_id) {
      return { entry, ok: false, needsFood: true, reason: '沒有食物庫對應（粗估或 GPT 估算），請先存成食物' };
    }
    const f = foodsById.get(entry.food_id);
    if (!f) return { entry, ok: false, needsFood: false, reason: '食物庫已找不到這個食物' };
    if (f.archived) return { entry, ok: false, needsFood: false, reason: `「${f.short_label}」已封存，請先到食物庫還原` };
    return { entry, ok: true, foodId: entry.food_id, reason: null };
  });
}

// 把勾選的紀錄整理成套餐組成：同一個食物合併份量，順序依第一次出現
export function buildItems(picks) {
  const items = [];
  const index = new Map();
  for (const { foodId, qty } of picks) {
    if (!(qty > 0)) throw new Error(`份量必須大於 0：${qty}`);
    if (index.has(foodId)) items[index.get(foodId)].qty = round2(items[index.get(foodId)].qty + qty);
    else {
      index.set(foodId, items.length);
      items.push({ food_id: foodId, qty: round2(qty) });
    }
  }
  return items;
}

const signature = (items) => items.map((i) => `${i.food_id}×${round2(i.qty)}`).sort().join('|');

export function findDuplicatePreset(presets, items) {
  const sig = signature(items);
  return [...presets.values()].find((p) => !p.archived && signature(p.items) === sig) ?? null;
}

export function findSameName(presets, label) {
  const n = normalizeQuery(label);
  return [...presets.values()].find((p) => !p.archived && normalizeQuery(p.label) === n) ?? null;
}

// 新套餐用的是「目前食物庫」的數值；列出和原紀錄快照不同的項目讓使用者知道
export function valueChanges(picks, foodsById) {
  const out = [];
  for (const { entry, foodId } of picks) {
    const f = foodsById.get(foodId);
    if (!f) continue;
    const kcalNow = f.kcal_book;
    const proteinNow = f.protein_book ?? null;
    const base = entry.level && entry.unit_kcal_mid_snapshot != null ? entry.unit_kcal_mid_snapshot : entry.unit_kcal_snapshot;
    if (kcalNow !== base || proteinNow !== (entry.unit_protein_snapshot ?? null)) {
      out.push({ label: f.short_label, was: { kcal: base, protein: entry.unit_protein_snapshot ?? null }, now: { kcal: kcalNow, protein: proteinNow } });
    }
  }
  return out;
}

// 沒有食物庫對應的紀錄 → 存成食物用的資料（不改動原紀錄）
export function foodDraftFromEntry(entry, { id, now = new Date() }) {
  const ranged = entry.unit_kcal_low_snapshot != null && entry.unit_kcal_high_snapshot != null && entry.unit_kcal_mid_snapshot != null;
  const label = entry.label_snapshot;
  return {
    id,
    short_label: [...label].slice(0, 5).join(''),
    full_name: entry.name_snapshot,
    kind: ranged ? 'opaque' : 'single',
    unit: entry.unit_snapshot || '份',
    kcal_book: ranged ? entry.unit_kcal_mid_snapshot : entry.unit_kcal_snapshot,
    kcal_low: ranged ? entry.unit_kcal_low_snapshot : null,
    kcal_high: ranged ? entry.unit_kcal_high_snapshot : null,
    protein_book: entry.unit_protein_snapshot ?? null,
    source_type: entry.source_type_snapshot === 'gpt_estimate' ? 'gpt_estimate' : 'rough',
    source_note: `由 ${entry.diet_day} 的紀錄存成食物${entry.gpt_raw_line ? `：${entry.gpt_raw_line}` : ''}`,
    needs_confirm: false,
    updated_at: now.toISOString(),
    archived: false,
  };
}
