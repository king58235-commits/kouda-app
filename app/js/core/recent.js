// 最近／最常吃：全部由現有紀錄推算，不存任何額外資料。
// 規則：
// - 獨立記下的食物（含「存成快捷」的粗估／GPT 食物）算一次使用；套餐只算「整組一次」，
//   套餐裡的組成不算單品的使用次數（否則茶葉蛋會因為套餐而虛增）。
// - 已封存、已不存在的食物／套餐不推薦。
// - 已經在首頁快捷格上的不再列出（這個入口是用來找回快捷格以外的東西）。
// - 最常吃：最近 30 個飲食日內的使用次數，次數相同的比較誰比較近。
import { addDays } from './day.js';

export const FREQUENT_WINDOW_DAYS = 30;

const keyOf = (type, id) => `${type}:${id}`;

export function recentAndFrequent({
  entries, foods, presets, quickSlots = [], today, days = FREQUENT_WINDOW_DAYS, limit = 8,
}) {
  const windowStart = addDays(today, -(days - 1));
  const inGrid = new Set(quickSlots.map((s) => keyOf(s.type, s.id)));
  const stats = new Map();
  const seenGroups = new Set();

  const touch = (type, id, e) => {
    const key = keyOf(type, id);
    const s = stats.get(key) ?? { type, id, lastAt: '', uses: 0 };
    if (e.created_at > s.lastAt) s.lastAt = e.created_at;
    if (e.diet_day >= windowStart && e.diet_day <= today) s.uses += 1;
    stats.set(key, s);
  };

  for (const e of entries) {
    if (e.group_id) {
      if (!e.preset_id || seenGroups.has(e.group_id)) continue;
      seenGroups.add(e.group_id);
      touch('preset', e.preset_id, e);
    } else if (e.food_id) {
      touch('food', e.food_id, e);
    }
  }

  const items = [];
  for (const s of stats.values()) {
    if (inGrid.has(keyOf(s.type, s.id))) continue;
    if (s.type === 'food') {
      const f = foods.get(s.id);
      if (!f || f.archived) continue;
      items.push({ ...s, label: f.short_label, kcal: f.kcal_book, opaque: f.kind === 'opaque' });
    } else {
      const p = presets.get(s.id);
      if (!p || p.archived) continue;
      items.push({ ...s, label: p.label, kcal: null, opaque: false });
    }
  }

  const byRecent = [...items].sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  const byFreq = items
    .filter((i) => i.uses > 0)
    .sort((a, b) => b.uses - a.uses || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return { recent: byRecent.slice(0, limit), frequent: byFreq.slice(0, limit) };
}
