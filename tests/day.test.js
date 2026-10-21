import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, boundaryHint, dietDayOf, isDayString } from '../app/js/core/day.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi);

test('05:00 換日：凌晨 01:30 算前一天（T08）', () => {
  assert.equal(dietDayOf(at(2026, 10, 22, 1, 30), 5), '2026-10-21');
});

test('05:00 換日：04:59 仍是前一天，05:00 起算新的一天', () => {
  assert.equal(dietDayOf(at(2026, 10, 22, 4, 59), 5), '2026-10-21');
  assert.equal(dietDayOf(at(2026, 10, 22, 5, 0), 5), '2026-10-22');
  assert.equal(dietDayOf(at(2026, 10, 21, 23, 59), 5), '2026-10-21');
});

test('跨月、跨年仍正確', () => {
  assert.equal(dietDayOf(at(2026, 11, 1, 2, 0), 5), '2026-10-31');
  assert.equal(dietDayOf(at(2027, 1, 1, 3, 0), 5), '2026-12-31');
  assert.equal(dietDayOf(at(2028, 3, 1, 1, 0), 5), '2028-02-29');
});

test('換日時間 0 等於日曆日期', () => {
  assert.equal(dietDayOf(at(2026, 10, 22, 0, 30), 0), '2026-10-22');
});

test('換日時間不合法會拒絕', () => {
  assert.throws(() => dietDayOf(at(2026, 10, 22, 1), 13));
  assert.throws(() => dietDayOf(at(2026, 10, 22, 1), 4.5));
  assert.throws(() => dietDayOf(at(2026, 10, 22, 1), -1));
});

test('跨日提示：01:30 顯示記入 10/21，可改記 10/22', () => {
  assert.deepEqual(boundaryHint(at(2026, 10, 22, 1, 30), 5), {
    show: true, dietDay: '2026-10-21', alternateDay: '2026-10-22',
  });
});

test('跨日提示：剛過換日 06:00 顯示記入 10/22，可改記 10/21', () => {
  assert.deepEqual(boundaryHint(at(2026, 10, 22, 6, 0), 5), {
    show: true, dietDay: '2026-10-22', alternateDay: '2026-10-21',
  });
});

test('跨日提示：白天與晚上不顯示', () => {
  assert.equal(boundaryHint(at(2026, 10, 22, 7, 0), 5).show, false);
  assert.equal(boundaryHint(at(2026, 10, 22, 12, 0), 5).show, false);
  assert.equal(boundaryHint(at(2026, 10, 22, 23, 59), 5).show, false);
});

test('飲食日字串檢查與加減日', () => {
  assert.equal(isDayString('2026-10-21'), true);
  assert.equal(isDayString('2026-02-30'), false);
  assert.equal(isDayString('2026/10/21'), false);
  assert.equal(addDays('2026-10-01', -1), '2026-09-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
