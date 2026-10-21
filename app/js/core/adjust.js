// 快捷卡片的「＋／−」：決定哪些紀錄可以被減號安全扣回。
// 原則：減號只動「獨立記下的食物紀錄」（origin=food、不屬於任何套餐群組）。
// 套餐裡的組成、GPT 估算、粗估都不會被單品的減號改到；套餐的減號一次拿掉最近的一整組。
import { withQty } from './ledger.js';

const round2 = (x) => Math.round(x * 100) / 100;

const isIndependentFood = (e) => e.origin === 'food' && !e.group_id;

// 最近的一筆：先比建立時間，再比 id，結果固定
function latest(list) {
  let best = null;
  for (const e of list) {
    if (!best || e.created_at > best.created_at || (e.created_at === best.created_at && e.id > best.id)) best = e;
  }
  return best;
}

// 這個食物在某一天被記了多少：total 是全部（含套餐裡的），removable 才是減號能扣的
export function foodUsage(entries, foodId, dietDay) {
  let total = 0;
  let removable = 0;
  let fromPreset = 0;
  let fromOther = 0;
  for (const e of entries) {
    if (e.diet_day !== dietDay || e.food_id !== foodId) continue;
    total += e.qty;
    if (isIndependentFood(e)) removable += e.qty;
    else if (e.group_id) fromPreset += e.qty;
    else fromOther += e.qty;
  }
  return {
    total: round2(total), removable: round2(removable), fromPreset: round2(fromPreset), fromOther: round2(fromOther),
  };
}

// 這個套餐在某一天被記了幾組
export function presetUsage(entries, presetId, dietDay) {
  const groups = new Set();
  for (const e of entries) {
    if (e.diet_day === dietDay && e.preset_id === presetId && e.group_id) groups.add(e.group_id);
  }
  return { groups: groups.size };
}

// 減少一份單品。份量 ≤ 1 就整筆刪除（0.5 不會變成負的）；否則減 1。
export function planDecrementFood(entries, foodId, dietDay, now) {
  const target = latest(entries.filter((e) => e.diet_day === dietDay && e.food_id === foodId && isIndependentFood(e)));
  if (!target) return null;
  if (target.qty <= 1) return { action: 'delete', entry: target };
  return { action: 'update', entry: target, next: withQty(target, round2(target.qty - 1), now) };
}

// 減少一組套餐：拿掉最近的一整個群組（群組裡所有單品一起刪）
export function planDecrementPreset(entries, presetId, dietDay) {
  const groups = new Map();
  for (const e of entries) {
    if (e.diet_day !== dietDay || e.preset_id !== presetId || !e.group_id) continue;
    const g = groups.get(e.group_id) ?? { groupId: e.group_id, newest: '', entries: [] };
    g.entries.push(e);
    if (e.created_at > g.newest) g.newest = e.created_at;
    groups.set(e.group_id, g);
  }
  let best = null;
  for (const g of groups.values()) {
    if (!best || g.newest > best.newest || (g.newest === best.newest && g.groupId > best.groupId)) best = g;
  }
  return best ? { groupId: best.groupId, entries: best.entries } : null;
}
