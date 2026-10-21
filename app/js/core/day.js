import { MAX_BOUNDARY_HOUR } from './constants.js';

const pad = (n) => String(n).padStart(2, '0');

export function formatLocalDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDayString(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

export function parseDay(s) {
  if (!isDayString(s)) throw new Error(`飲食日格式錯誤：${s}`);
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return formatLocalDate(d);
}

export function assertBoundaryHour(h) {
  if (!Number.isInteger(h) || h < 0 || h > MAX_BOUNDARY_HOUR) {
    throw new Error(`換日時間必須是 0–${MAX_BOUNDARY_HOUR} 的整數小時：${h}`);
  }
}

// 以手機當地時間計算：換日時間之前的紀錄算前一個飲食日
export function dietDayOf(date, boundaryHour) {
  assertBoundaryHour(boundaryHour);
  const shifted = new Date(
    date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours() - boundaryHour, date.getMinutes(), date.getSeconds(),
  );
  return formatLocalDate(shifted);
}

// 跨日提示：午夜到換日時間之間（日曆日期≠飲食日），或剛過換日時間 windowHours 小時內
export function boundaryHint(date, boundaryHour, windowHours = 2) {
  const dietDay = dietDayOf(date, boundaryHour);
  const calendarDay = formatLocalDate(date);
  if (calendarDay !== dietDay) {
    return { show: true, dietDay, alternateDay: calendarDay };
  }
  const hoursSinceBoundary = date.getHours() + date.getMinutes() / 60 - boundaryHour;
  if (hoursSinceBoundary >= 0 && hoursSinceBoundary < windowHours) {
    return { show: true, dietDay, alternateDay: addDays(dietDay, -1) };
  }
  return { show: false, dietDay, alternateDay: null };
}
