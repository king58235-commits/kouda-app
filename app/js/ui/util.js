// 畫面共用工具：HTML 樣板（自動跳脫）、提示、底部面板、剪貼簿、檔案下載。
// 所有使用者或 GPT 輸入的文字都要經過 esc，避免匯入檔案或貼上內容夾帶 HTML。

import { prefersReducedMotion } from './morph.js';

export class Raw {
  constructor(s) { this.s = s; }

  toString() { return this.s; }
}

export const raw = (s) => new Raw(s);

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function part(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(String(v));
}

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? part(vals[i]) : ''); });
  return new Raw(out);
}

// ---- 提示（可撤銷）----

export function createToaster(root) {
  let timer = null;
  function hide() {
    clearTimeout(timer);
    root.innerHTML = '';
  }
  function show(message, { undo = null, kind = 'info', ms = 6000 } = {}) {
    hide();
    root.innerHTML = html`<div class="toast ${kind}" role="status">
      <span class="toast-msg">${message}</span>
      ${undo ? html`<button class="toast-undo" data-act="toast-undo" data-undo="${undo}">撤銷</button>` : ''}
    </div>`.s;
    timer = setTimeout(hide, kind === 'error' ? Math.max(ms, 9000) : ms);
  }
  return { show, hide };
}

// ---- 底部面板（Android 返回鍵可以關閉）----

export function createSheetManager(root) {
  let open = false;
  let current = null;
  let backInFlight = false;
  let queued = null;
  let safety = null;

  let closeTimer = null;

  function wipe() {
    clearTimeout(closeTimer);
    root.classList.remove('closing', 'swap');
    root.innerHTML = '';
  }

  // 關閉時先播退場動畫（約 190 ms）再清掉；期間不擋點擊
  function closeUi() {
    clearTimeout(closeTimer);
    if (prefersReducedMotion()) { wipe(); return; }
    root.classList.add('closing');
    closeTimer = setTimeout(() => {
      if (!open) wipe();
      else root.classList.remove('closing');
    }, 190);
  }

  function render({ title, body, onMount }, swapping) {
    clearTimeout(closeTimer);
    root.classList.remove('closing');
    root.classList.toggle('swap', swapping); // 同一個面板換內容時不重播進場動畫
    root.innerHTML = html`<div class="backdrop" data-act="sheet-close"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${title}">
        <header class="sheet-head"><h2>${title}</h2><button class="icon-btn" data-act="sheet-close" aria-label="關閉">✕</button></header>
        <div class="sheet-body">${body}</div>
      </section>`.s;
    onMount?.(root);
  }

  function show(opts) {
    if (backInFlight) { queued = opts; return; }
    const swapping = open;
    if (!open) {
      history.pushState({ sheet: true }, '');
      open = true;
      document.body.classList.add('sheet-open');
    }
    current = opts;
    render(opts, swapping);
  }

  function dismissed() {
    const c = current;
    current = null;
    document.body.classList.remove('sheet-open');
    c?.onClose?.();
  }

  function close() {
    if (!open) return;
    open = false;
    closeUi();
    dismissed();
    if (history.state?.sheet) {
      backInFlight = true;
      history.back();
      safety = setTimeout(() => finishBack(), 400);
    }
  }

  function finishBack() {
    clearTimeout(safety);
    backInFlight = false;
    if (queued) {
      const q = queued;
      queued = null;
      show(q);
    }
  }

  window.addEventListener('popstate', () => {
    if (backInFlight) { finishBack(); return; }
    if (open) { open = false; closeUi(); dismissed(); }
  });

  return { show, close, get isOpen() { return open; }, root };
}

// ---- 剪貼簿、檔案 ----

export async function copyText(text, fallbackEl = null) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 改用備援方式 */ }
  try {
    const ta = fallbackEl ?? Object.assign(document.createElement('textarea'), { value: text });
    if (!fallbackEl) {
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
    }
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    if (!fallbackEl) ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export async function readClipboardText() {
  if (!navigator.clipboard?.readText) throw new Error('這個瀏覽器不能直接讀取剪貼簿，請長按下面的輸入框貼上。');
  return navigator.clipboard.readText();
}

export function downloadText(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function shareFile(filename, text, type = 'application/json') {
  const file = new File([text], filename, { type });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return true; // 使用者自己取消分享面板
    return false;
  }
}

export const canShareFiles = () => {
  try { return Boolean(navigator.canShare?.({ files: [new File(['x'], 'x.json', { type: 'application/json' })] })); } catch { return false; }
};

// ---- 點擊回饋 ----

// 卡片上飄起的「+1／−1」。data-keep 讓局部更新不會把它當成多餘元素移除。
export function fly(el, text) {
  if (!el || prefersReducedMotion()) return;
  const s = document.createElement('span');
  s.className = 'fly';
  s.setAttribute('data-keep', '');
  s.setAttribute('aria-hidden', 'true');
  s.textContent = text;
  el.appendChild(s);
  setTimeout(() => s.remove(), 720);
}

export function tapOk(el) {
  if (!el || prefersReducedMotion()) return;
  el.classList.add('tap-ok');
  setTimeout(() => el.classList.remove('tap-ok'), 320);
}
