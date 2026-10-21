// 網站本身的檢查：模組都載得進來、離線快取清單是最新的、公開網站裡沒有任何私人資料。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyStamp, computeStamp, listAppFiles, readStamp } from '../tools/stamp-version.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APP = join(ROOT, 'app');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}
const rel = (f) => relative(ROOT, f).split(sep).join('/');

test('每個 JS 模組都能載入（語法正確、相對路徑的 import 都存在）', async () => {
  const files = walk(join(APP, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('main.js') && !f.endsWith(`${sep}sw.js`));
  assert.ok(files.length >= 20, `只找到 ${files.length} 個模組`);
  for (const f of files) await import(pathToFileURL(f).href);
});

test('所有 import 的相對路徑都指到真的檔案', () => {
  const bad = [];
  for (const f of walk(APP).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
      if (!existsSync(resolve(dirname(f), m[1]))) bad.push(`${rel(f)} → ${m[1]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('index.html 與 manifest 引用的檔案都存在，圖示是真正的 PNG', () => {
  const index = readFileSync(join(APP, 'index.html'), 'utf8');
  const refs = [...index.matchAll(/(?:href|src)="([^"#]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('http'));
  assert.ok(refs.length >= 5);
  for (const r of refs) assert.ok(existsSync(join(APP, r)), `index.html 引用了不存在的 ${r}`);

  const manifest = JSON.parse(readFileSync(join(APP, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const buf = readFileSync(join(APP, icon.src));
    assert.equal(buf.subarray(1, 4).toString(), 'PNG', `${icon.src} 不是 PNG`);
    const [w] = icon.sizes.split('x').map(Number);
    assert.equal(buf.readUInt32BE(16), w, `${icon.src} 寬度和 manifest 不符`);
  }
});

test('sw.js 的版本戳記是最新的：網站檔案有改就要執行 npm run stamp', () => {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8').replace(/\r\n/g, '\n');
  const stamp = computeStamp();
  assert.equal(applyStamp(sw, stamp), sw, 'sw.js 過期了，請執行：npm run stamp');
  const cur = readStamp(sw);
  assert.equal(cur.version, stamp.version);
  assert.deepEqual(cur.precache, stamp.precache);
  assert.ok(stamp.precache.includes('./') && stamp.precache.includes('index.html') && stamp.precache.includes('js/main.js'));
  assert.ok(!stamp.precache.includes('sw.js'));
});

test('離線快取清單涵蓋 app/ 底下每一個檔案', () => {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
  const { precache } = readStamp(sw);
  for (const f of listAppFiles()) assert.ok(precache.includes(f), `${f} 沒有被預先快取`);
});

test('service worker 不碰使用者資料：沒有 IndexedDB、沒有 clear、只刪自己的快取', () => {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
  assert.doesNotMatch(sw, /indexedDB|localStorage/);
  assert.match(sw, /startsWith\(CACHE_PREFIX\)/);
});

const PRIVATE_MARKERS = ['Form_Responses', 'latte_regular', '老樣子拿鐵', 'box_cal_chicken', '給力盒子', 'seed.json 的內容', 'kouda-backup'];

test('公開網站（app/）裡沒有私人種子、備份、Excel 或食物清單內容', () => {
  const files = walk(APP);
  for (const f of files) {
    const name = rel(f);
    assert.doesNotMatch(name, /seed.*\.json$|kouda-(backup|library)|\.xlsx$|\.csv$/i, `${name} 的檔名像私人資料`);
    if (/\.(png)$/i.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of PRIVATE_MARKERS.filter((x) => x !== 'kouda-backup')) {
      assert.ok(!text.includes(m), `${name} 含有私人資料字樣「${m}」`);
    }
  }
  const jsonFiles = files.filter((f) => f.endsWith('.json') || f.endsWith('.webmanifest')).map(rel);
  assert.deepEqual(jsonFiles, ['app/manifest.webmanifest']);
});

test('.gitignore 擋住私人資料；若這裡是 Git 儲存庫，private/ 真的不會被追蹤', () => {
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  for (const pat of ['private/', 'kouda-backup-*.json', 'kouda-library-*.json', '*.xlsx']) {
    assert.ok(ignore.split('\n').includes(pat), `.gitignore 缺少 ${pat}`);
  }
  if (!existsSync(join(ROOT, '.git'))) return;
  const run = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  for (const p of ['private/seed.json', 'kouda-backup-20260101-0000.json', 'kouda-library-20260101-0000.json', 'x.xlsx']) {
    assert.doesNotThrow(() => run('check-ignore', '-q', p), `${p} 沒有被 .gitignore 擋住`);
  }
  const candidates = run('ls-files', '--cached', '--others', '--exclude-standard').split('\n');
  assert.ok(!candidates.some((f) => f.startsWith('private/')), 'private/ 裡的檔案會被加入儲存庫');
  assert.ok(candidates.includes('app/index.html'));
});

test('部署流程只發布 app/，並且部署前會檢查', () => {
  const wf = join(ROOT, '.github', 'workflows', 'pages.yml');
  assert.ok(existsSync(wf), '缺少 .github/workflows/pages.yml');
  const text = readFileSync(wf, 'utf8');
  assert.match(text, /path:\s*app\b/);
  assert.match(text, /npm test/);
  assert.match(text, /stamp-version\.js --check/);
  assert.doesNotMatch(text, /path:\s*(\.|\.\/|private)\s*$/m);
});
