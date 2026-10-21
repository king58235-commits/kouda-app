import { parseDay } from './day.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n) => String(n).padStart(2, '0');

// 熱量一律顯示整數，加千分位
export function fmtKcal(n) {
  return Math.round(n).toLocaleString('en-US');
}

// 公克：整數不帶小數，否則最多一位（15.1）
export function fmtGram(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function fmtQty(q) {
  return `×${Math.round(q * 100) / 100}`;
}

export function fmtTime(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function weekdayZh(dayStr) {
  return WEEKDAYS[parseDay(dayStr).getDay()];
}

// 2026-10-21 → 10/21（三）
export function fmtDay(dayStr) {
  const [, m, d] = dayStr.split('-').map(Number);
  return `${m}/${d}（${weekdayZh(dayStr)}）`;
}

export function fmtDateTime(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtTime(d)}`;
}

export function fileStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
