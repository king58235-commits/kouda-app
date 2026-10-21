// IndexedDB 版資料庫：帳本與食物庫唯一的持久化位置。
// 所有寫入都在單一交易內完成；交易失敗就整批不生效。
import { DB_NAME, DB_VERSION, emptyRows, keyOf, STORE_NAMES, STORES } from './schema.js';

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('交易被中止'));
  });
}

export class IdbRepo {
  constructor(db) {
    this.db = db;
    db.onversionchange = () => db.close();
  }

  static open(name = DB_NAME) {
    return new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('這個瀏覽器無法使用本機資料庫（IndexedDB）。請不要用無痕模式，或換用 Chrome。'));
        return;
      }
      const req = indexedDB.open(name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [store, keyPath] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(store)) {
            const os = db.createObjectStore(store, { keyPath });
            if (store === 'entries') os.createIndex('by_day', 'diet_day');
          }
        }
      };
      req.onblocked = () => reject(new Error('資料庫被另一個分頁佔用，請關閉其他分頁後重新整理。'));
      req.onerror = () => reject(req.error ?? new Error('無法開啟本機資料庫'));
      req.onsuccess = () => resolve(new IdbRepo(req.result));
    });
  }

  async loadAll() {
    const rows = emptyRows();
    const tx = this.db.transaction(STORE_NAMES, 'readonly');
    await Promise.all(STORE_NAMES.map(async (s) => { rows[s] = await promisify(tx.objectStore(s).getAll()); }));
    return rows;
  }

  async commit(change) {
    const stores = [...new Set([...Object.keys(change.put ?? {}), ...Object.keys(change.del ?? {})])];
    if (!stores.length) return;
    const tx = this.db.transaction(stores, 'readwrite');
    const done = txDone(tx);
    try {
      for (const [s, keys] of Object.entries(change.del ?? {})) for (const k of keys) tx.objectStore(s).delete(k);
      for (const [s, objs] of Object.entries(change.put ?? {})) for (const o of objs) tx.objectStore(s).put(o);
    } catch (err) {
      tx.abort();
      await done.catch(() => {});
      throw err;
    }
    await done;
  }

  // 完整還原：清空再寫入，同一個交易；中途失敗會整批退回原狀
  async replaceAll(rows) {
    const tx = this.db.transaction(STORE_NAMES, 'readwrite');
    const done = txDone(tx);
    try {
      for (const s of STORE_NAMES) {
        const os = tx.objectStore(s);
        os.clear();
        for (const o of rows[s] ?? []) {
          keyOf(s, o);
          os.put(o);
        }
      }
    } catch (err) {
      tx.abort();
      await done.catch(() => {});
      throw err;
    }
    await done;
  }

  async close() {
    this.db.close();
  }
}

export async function deleteDatabase(name = DB_NAME) {
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
