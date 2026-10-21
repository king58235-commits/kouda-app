import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureDay, withGoals } from '../app/js/core/days.js';
import { entryFromFood, roughEntry, withQty } from '../app/js/core/ledger.js';
import { dayTotals } from '../app/js/core/summary.js';
import { loadSample, NOW } from './helpers.js';

const DAY = '2026-10-21';

test('剩餘 = 當日目標 − 已記；只算這一天', () => {
  const { foods } = loadSample();
  const day = { diet_day: DAY, kcal_goal: 1800, protein_goal: 110 };
  const entries = [
    entryFromFood(foods.get('t_box'), { dietDay: DAY, now: NOW }),
    entryFromFood(foods.get('t_egg'), { dietDay: DAY, qty: 2, now: NOW }),
    entryFromFood(foods.get('t_box'), { dietDay: '2026-10-20', now: NOW }),
  ];
  const t = dayTotals(entries, day);
  assert.equal(t.entry_count, 2);
  assert.equal(t.eaten_kcal, 620);
  assert.equal(t.remaining_kcal, 1180);
  assert.equal(t.over_kcal, 0);
});

test('超標顯示負數，不歸零（T07）', () => {
  const day = { diet_day: DAY, kcal_goal: 1800, protein_goal: 110 };
  const t = dayTotals([roughEntry({ dietDay: DAY, kcal: 1920, now: NOW })], day);
  assert.equal(t.remaining_kcal, -120);
  assert.equal(t.over_kcal, 120);
});

test('蛋白質未知不算 0：只加已知值，另計未知項數', () => {
  const { foods } = loadSample();
  const day = { diet_day: DAY, kcal_goal: 1800, protein_goal: 110 };
  const entries = [
    entryFromFood(foods.get('t_latte'), { dietDay: DAY, qty: 2, now: NOW }),
    entryFromFood(foods.get('t_box'), { dietDay: DAY, now: NOW }),
  ];
  const t = dayTotals(entries, day);
  assert.equal(t.protein_known_g, 42);
  assert.equal(t.protein_unknown_count, 1);
  assert.equal(t.protein_gap_known_g, 68);
  assert.equal(t.needs_confirm_count, 2);
});

test('半份與小數不產生浮點誤差', () => {
  const { foods } = loadSample();
  const day = { diet_day: DAY, kcal_goal: 1800, protein_goal: 110 };
  const e = withQty(entryFromFood(foods.get('t_egg'), { dietDay: DAY, now: NOW }), 0.5, NOW);
  const p = { ...roughEntry({ dietDay: DAY, kcal: 0.1, protein: 0.2, now: NOW }) };
  const t = dayTotals([e, p, { ...p, id: 'x' }], day);
  assert.equal(t.eaten_kcal, 37.7);
  assert.equal(t.protein_known_g, 3.4);
});

test('每日目標快照：改預設目標不會改到已建立的那一天（T09）', () => {
  const settings = { kcal_goal_default: 1800, protein_goal_default: 110 };
  const days = new Map();
  const { day: d1, created } = ensureDay(days, '2026-10-20', settings);
  assert.equal(created, true);

  settings.kcal_goal_default = 1700;
  const again = ensureDay(days, '2026-10-20', settings);
  assert.equal(again.created, false);
  assert.equal(again.day.kcal_goal, 1800);
  assert.equal(ensureDay(days, '2026-10-21', settings).day.kcal_goal, 1700);

  const changed = withGoals(d1, { kcalGoal: 1600, proteinGoal: 100 });
  assert.equal(changed.kcal_goal, 1600);
  assert.equal(d1.kcal_goal, 1800);
  assert.throws(() => withGoals(d1, { kcalGoal: 0, proteinGoal: 100 }));
});
