// 加總：只加這一天的紀錄；蛋白質空值不算進總和，而是計入「未知項數」
const r1 = (x) => Math.round(x * 10) / 10;

export function entryKcal(entry) {
  return entry.qty * entry.unit_kcal_snapshot;
}

export function entryProtein(entry) {
  return entry.unit_protein_snapshot == null ? null : entry.qty * entry.unit_protein_snapshot;
}

export function dayTotals(entries, day) {
  const list = entries.filter((e) => e.diet_day === day.diet_day);
  let kcal = 0;
  let protein = 0;
  let proteinUnknown = 0;
  let rough = 0;
  let gpt = 0;
  let needsConfirm = 0;
  for (const e of list) {
    kcal += entryKcal(e);
    const p = entryProtein(e);
    if (p === null) proteinUnknown += 1;
    else protein += p;
    if (e.source_type_snapshot === 'rough') rough += 1;
    if (e.source_type_snapshot === 'gpt_estimate') gpt += 1;
    if (e.needs_confirm_snapshot) needsConfirm += 1;
  }
  const eaten = r1(kcal);
  const remaining = r1(day.kcal_goal - eaten);
  const proteinKnown = r1(protein);
  return {
    diet_day: day.diet_day,
    kcal_goal: day.kcal_goal,
    protein_goal: day.protein_goal,
    entry_count: list.length,
    eaten_kcal: eaten,
    remaining_kcal: remaining,
    over_kcal: remaining < 0 ? -remaining : 0,
    protein_known_g: proteinKnown,
    protein_unknown_count: proteinUnknown,
    protein_gap_known_g: Math.max(0, r1(day.protein_goal - proteinKnown)),
    rough_count: rough,
    gpt_count: gpt,
    needs_confirm_count: needsConfirm,
  };
}

// 套餐預覽：從目前食物庫現算，不讀任何存起來的套餐總數
export function presetTotals(preset, foodsById) {
  let kcal = 0;
  let protein = 0;
  let proteinUnknown = 0;
  for (const item of preset.items) {
    const food = foodsById.get(item.food_id);
    if (!food) throw new Error(`套餐「${preset.label}」引用了不存在的食物：${item.food_id}`);
    kcal += item.qty * food.kcal_book;
    if (food.protein_book == null) proteinUnknown += 1;
    else protein += item.qty * food.protein_book;
  }
  return { kcal: r1(kcal), protein_known_g: r1(protein), protein_unknown_count: proteinUnknown };
}
