// 本地 SVG 圖示（單色、描邊、跟隨文字顏色）。不依賴任何外部字型或圖片，離線也能顯示。
// 全部是固定的內建字串，不含使用者輸入；用 raw() 包起來讓 html`` 樣板不會再跳脫。
import { raw } from './util.js';

const PATHS = {
  back: '<path d="m15 5-7 7 7 7"/>',
  next: '<path d="m9 5 7 7-7 7"/>',
  caret: '<path d="m9 6 6 6-6 6"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  library: '<path d="M5 4.5h10a3 3 0 0 1 3 3V19.5H8a3 3 0 0 1-3-3z"/><path d="M5 16.5a3 3 0 0 1 3-3h10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  compose: '<path d="M12 4 4 8l8 4 8-4z"/><path d="m4 12 8 4 8-4M4 16l8 4 8-4"/>',
  paste: '<rect x="6" y="5" width="12" height="15" rx="2.5"/><path d="M9.5 5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V5M12 9.5v6m-2.5-2.5 2.5 2.5 2.5-2.5"/>',
  share: '<path d="M7 17 17 7M9 7h8v8"/>',
  clipboard: '<rect x="6" y="5" width="12" height="15" rx="2.5"/><path d="M9.5 5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V5"/>',
  pin: '<path d="m9 4.5 6 0 .5 5 2.5 3H6l2.5-3z"/><path d="M12 13v6.5"/>',
  save: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h9l3.5 3.5v10A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5z"/><path d="M8.5 4v4.5h6V4M8.5 19v-5h7v5"/>',
  update: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 5v4.5h-4.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
  empty: '<rect x="4.5" y="6" width="15" height="13" rx="3"/><path d="M8.5 6V5a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 5v1M9 12.5h6"/>',
};

export function icon(name, { size = 20, cls = '' } = {}) {
  const d = PATHS[name];
  if (!d) throw new Error(`沒有這個圖示：${name}`);
  return raw(`<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`);
}

// 品牌標誌：額度環加中心圓點（和 PWA 圖示一致），用在首次使用畫面
export const logoMark = (size = 56) => raw(`<svg class="logo" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="22" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-dasharray="118 20" transform="rotate(-62 32 32)"/><circle cx="32" cy="32" r="6.5" fill="currentColor"/></svg>`);

export const ICON_NAMES = Object.keys(PATHS);
