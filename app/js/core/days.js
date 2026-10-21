// 每個飲食日在第一次使用時，把當時的預設目標存成快照；之後改預設目標不會改到這一天
import { isDayString } from './day.js';

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

function assertGoals(kcalGoal, proteinGoal) {
  if (!isNum(kcalGoal) || kcalGoal <= 0) throw new Error(`熱量目標必須大於 0：${kcalGoal}`);
  if (!isNum(proteinGoal) || proteinGoal < 0) throw new Error(`蛋白質目標必須是 0 以上：${proteinGoal}`);
}

export function newDay(dietDay, settings) {
  if (!isDayString(dietDay)) throw new Error(`飲食日格式錯誤：${dietDay}`);
  assertGoals(settings.kcal_goal_default, settings.protein_goal_default);
  return {
    diet_day: dietDay,
    kcal_goal: settings.kcal_goal_default,
    protein_goal: settings.protein_goal_default,
  };
}

// daysByKey 是 Map<diet_day, Day>；已存在就原樣回傳，不會用新的預設值覆蓋
export function ensureDay(daysByKey, dietDay, settings) {
  const existing = daysByKey.get(dietDay);
  if (existing) return { day: existing, created: false };
  const day = newDay(dietDay, settings);
  daysByKey.set(dietDay, day);
  return { day, created: true };
}

// 使用者明確要改某一天（通常是今天）的目標時才用
export function withGoals(day, { kcalGoal, proteinGoal }) {
  assertGoals(kcalGoal, proteinGoal);
  return { ...day, kcal_goal: kcalGoal, protein_goal: proteinGoal };
}
