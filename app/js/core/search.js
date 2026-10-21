// 食物庫搜尋：全部在本機比對，不送出任何東西。
// 容錯：前後空白、多個空白、英文大小寫、全形半形；多個關鍵字要全部都對得上。

export function normalizeQuery(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function hit(parts, q) {
  const n = normalizeQuery(q);
  if (!n) return true;
  const hay = normalizeQuery(parts.filter(Boolean).join(' '));
  return n.split(' ').every((tok) => hay.includes(tok));
}

export const matchFood = (f, q) => hit([f.short_label, f.full_name, f.unit], q);

export function matchPreset(p, q, foodsById) {
  const names = p.items.flatMap((i) => {
    const f = foodsById.get(i.food_id);
    return f ? [f.short_label, f.full_name] : [];
  });
  return hit([p.label, ...names], q);
}

export function searchLibrary({ foods, presets, query }) {
  const f = [...foods.values()].filter((x) => matchFood(x, query));
  const p = [...presets.values()].filter((x) => matchPreset(x, query, foods));
  return { foods: f, presets: p };
}
