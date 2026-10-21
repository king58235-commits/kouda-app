// 資料庫結構：每個 store 的主鍵。IndexedDB 與記憶體版本共用。
export const DB_NAME = 'kouda-v1';
export const DB_VERSION = 1;

export const STORES = {
  foods: 'id',
  presets: 'id',
  days: 'diet_day',
  entries: 'id',
  meta: 'key',
};

export const STORE_NAMES = Object.keys(STORES);

export function keyOf(store, obj) {
  return obj[STORES[store]];
}

export function emptyRows() {
  return Object.fromEntries(STORE_NAMES.map((s) => [s, []]));
}
