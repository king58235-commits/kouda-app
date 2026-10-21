// 記憶體版資料庫：只給自動測試用，行為（原子性、複製）與 IndexedDB 版一致。
import { emptyRows, keyOf, STORE_NAMES } from '../../app/js/store/schema.js';

export class MemoryRepo {
  constructor() {
    this.tables = Object.fromEntries(STORE_NAMES.map((s) => [s, new Map()]));
    this.failNext = false; // 測試用：讓下一次寫入失敗，驗證失敗時資料不會被改一半
  }

  async loadAll() {
    const rows = emptyRows();
    for (const s of STORE_NAMES) rows[s] = [...this.tables[s].values()].map((x) => structuredClone(x));
    return rows;
  }

  // change: { put: {store: [obj]}, del: {store: [key]} }，整批成功或整批不做
  async commit(change) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('模擬寫入失敗');
    }
    const staged = Object.fromEntries(STORE_NAMES.map((s) => [s, new Map(this.tables[s])]));
    for (const [s, keys] of Object.entries(change.del ?? {})) for (const k of keys) staged[s].delete(k);
    for (const [s, objs] of Object.entries(change.put ?? {})) {
      for (const o of objs) staged[s].set(keyOf(s, o), structuredClone(o));
    }
    this.tables = staged;
  }

  async replaceAll(rows) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('模擬寫入失敗');
    }
    const staged = Object.fromEntries(STORE_NAMES.map((s) => [s, new Map()]));
    for (const s of STORE_NAMES) for (const o of rows[s] ?? []) staged[s].set(keyOf(s, o), structuredClone(o));
    this.tables = staged;
  }

  async close() {}
}
