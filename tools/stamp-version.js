// 用法：node tools/stamp-version.js [--check]
// 掃描 app/ 的所有檔案，把「版本（內容雜湊）」與「預先快取清單」寫進 app/sw.js 的 STAMP 區塊。
// --check：不寫入，只檢查 sw.js 是否是最新（測試與部署流程用）。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));
const BEGIN = '/* STAMP:BEGIN */';
const END = '/* STAMP:END */';

export function listAppFiles(dir = APP_DIR) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.filter((f) => f !== 'sw.js').sort();
}

// 文字檔的換行（CRLF／LF）不影響版本：Windows 與 GitHub 上算出來的版本要一樣
const TEXT_FILE = /\.(js|css|html|json|webmanifest|txt|md)$/;
function hashable(file, buf) {
  return TEXT_FILE.test(file) ? Buffer.from(buf.toString('utf8').replaceAll('\r\n', '\n')) : buf;
}

export function computeStamp(dir = APP_DIR) {
  const files = listAppFiles(dir);
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f);
    h.update('\0');
    h.update(hashable(f, readFileSync(join(dir, f))));
    h.update('\0');
  }
  return { version: h.digest('hex').slice(0, 10), precache: ['./', ...files] };
}

export function renderStamp({ version, precache }) {
  return `${BEGIN}\nconst VERSION = '${version}';\nconst PRECACHE = ${JSON.stringify(precache)};\n${END}`;
}

export function applyStamp(swText, stamp) {
  const a = swText.indexOf(BEGIN);
  const b = swText.indexOf(END);
  if (a < 0 || b < a) throw new Error('sw.js 裡找不到 STAMP 區塊');
  return swText.slice(0, a) + renderStamp(stamp) + swText.slice(b + END.length);
}

export function readStamp(swText) {
  const a = swText.indexOf(BEGIN);
  const b = swText.indexOf(END);
  if (a < 0 || b < a) return null;
  const block = swText.slice(a, b);
  const version = /const VERSION = '([^']*)'/.exec(block)?.[1];
  const list = /const PRECACHE = (\[.*\]);/.exec(block)?.[1];
  return { version, precache: list ? JSON.parse(list) : null };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const swPath = join(APP_DIR, 'sw.js');
  const sw = readFileSync(swPath, 'utf8').replace(/\r\n/g, '\n');
  const stamp = computeStamp();
  const next = applyStamp(sw, stamp);
  if (process.argv.includes('--check')) {
    if (next !== sw) {
      console.error('sw.js 的版本戳記過期了（網站檔案有變）。請執行：npm run stamp');
      process.exit(1);
    }
    console.log(`sw.js 版本戳記是最新的（${stamp.version}，${stamp.precache.length} 項）`);
  } else {
    writeFileSync(swPath, next);
    console.log(`已更新 sw.js：版本 ${stamp.version}，預先快取 ${stamp.precache.length} 項`);
  }
}
