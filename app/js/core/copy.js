// 複製以前的餐點到另一天。
// 一律用「原紀錄的快照」複製（熱量、蛋白質、份量、來源都照舊），不套用後來改過的食物庫數值；
// 新紀錄有新的 id、現在的時間、目標飲食日；套餐群組會建立新的 group_id，不和原群組共用。
import { pickLevelKcal } from './ledger.js';

const iso = (ms) => new Date(ms).toISOString();

// 有紀錄的日子（不含目標日），新的在前
export function daysWithEntries(entries, excludeDay) {
  const map = new Map();
  for (const e of entries) {
    if (e.diet_day === excludeDay) continue;
    const d = map.get(e.diet_day) ?? { day: e.diet_day, count: 0, kcal: 0 };
    d.count += 1;
    d.kcal += e.qty * e.unit_kcal_snapshot;
    map.set(e.diet_day, d);
  }
  return [...map.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

// 某一天可以勾選的單位：獨立紀錄一筆一個、套餐整組一個（依時間排序）
export function selectableUnits(entries, day) {
  const list = entries
    .filter((e) => e.diet_day === day)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  const units = [];
  const groups = new Map();
  for (const e of list) {
    if (!e.group_id) {
      units.push({ type: 'entry', id: e.id, label: e.label_snapshot, entries: [e] });
      continue;
    }
    let g = groups.get(e.group_id);
    if (!g) {
      g = { type: 'group', id: e.group_id, label: e.group_label, entries: [] };
      groups.set(e.group_id, g);
      units.push(g);
    }
    g.entries.push(e);
  }
  return units;
}

// 選取的單位合計（用來預覽）
export function totalsOfUnits(units) {
  let kcal = 0;
  let protein = 0;
  let unknown = 0;
  for (const u of units) {
    for (const e of u.entries) {
      kcal += e.qty * e.unit_kcal_snapshot;
      if (e.unit_protein_snapshot == null) unknown += 1;
      else protein += e.qty * e.unit_protein_snapshot;
    }
  }
  return { kcal: Math.round(kcal * 10) / 10, protein: Math.round(protein * 10) / 10, unknown };
}

// 食物庫現在的數值和原紀錄不同的項目（複製仍用原紀錄，只是提醒）
export function snapshotDiffs(units, foodsById) {
  const out = [];
  for (const u of units) {
    for (const e of u.entries) {
      const f = e.food_id ? foodsById.get(e.food_id) : null;
      if (!f) continue;
      const curKcal = f.kind === 'opaque' && e.level
        ? pickLevelKcal({ low: f.kcal_low, mid: f.kcal_book, high: f.kcal_high }, e.level)
        : f.kcal_book;
      const curProtein = f.protein_book ?? null;
      if (curKcal !== e.unit_kcal_snapshot || curProtein !== (e.unit_protein_snapshot ?? null)) {
        out.push({
          label: e.label_snapshot,
          was: { kcal: e.unit_kcal_snapshot, protein: e.unit_protein_snapshot ?? null },
          now: { kcal: curKcal, protein: curProtein },
        });
      }
    }
  }
  return out;
}

// 產生要寫入的新紀錄。ids.entry(舊id)／ids.group(舊群組id) 由呼叫端提供，
// 同一個確認畫面重複送出時會得到同樣的 id（寫入是冪等的）。
export function planCopy({ units, targetDay, nowMs, ids }) {
  if (!units.length) throw new Error('沒有選任何項目');
  let n = 0;
  const entries = [];
  for (const u of units) {
    for (const src of u.entries) {
      if (src.diet_day === targetDay) throw new Error('來源日期和目標日期相同，不能複製');
      const t = iso(nowMs + n);
      n += 1;
      entries.push({
        ...src,
        id: ids.entry(src.id),
        diet_day: targetDay,
        created_at: t,
        updated_at: t,
        group_id: src.group_id ? ids.group(src.group_id) : null,
      });
    }
  }
  return entries;
}
