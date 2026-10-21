// 局部更新：把新產生的 HTML 對照到現有的 DOM，只改有變的地方。
// 這樣：卡片按下的動畫、清單的進退場、數字與進度條的平滑變化、焦點與捲動位置都不會被整頁重繪打斷。
// 約定的屬性：
//   data-key      有這個屬性的元素會依 key 配對（可搬位置、可進退場）
//   data-enter    新插入時播放進場動畫
//   data-leave    被移除時播放退場動畫（高度收合）
//   data-tween    數字平滑變化：屬性值是目標數字
//   data-pulse    屬性值改變時閃一下
//   data-keep     不屬於樣板的暫時元素（例如 +1 回饋），更新時保留
//   data-keepstate 手勢中的元素：保留 style 與 data-swipe* 屬性
//   data-static   內容完全不更新

const DYNAMIC_CLASSES = ['enter', 'pulse', 'tap-ok'];
const NUMBER_MS = 260;

export const prefersReducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

const keyOf = (n) => (n.nodeType === 1 ? n.getAttribute('data-key') : null);
const isLeaving = (n) => n.nodeType === 1 && n.hasAttribute('data-leaving');
const isKeep = (n) => n.nodeType === 1 && n.hasAttribute('data-keep');
const live = (n) => { let x = n; while (x && (isLeaving(x) || isKeep(x))) x = x.nextSibling; return x; };

export function morphInto(root, html, { animate = true } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  reconcile(root, [...tpl.content.childNodes], animate && !prefersReducedMotion());
}

function sameKind(a, b) {
  if (a.nodeType !== b.nodeType) return false;
  return a.nodeType === 3 || a.nodeName === b.nodeName;
}

function fresh(t, animate) {
  const n = document.importNode(t, true);
  if (animate && n.nodeType === 1 && n.hasAttribute('data-enter')) {
    n.classList.add('enter');
    const done = () => n.classList.remove('enter');
    n.addEventListener('animationend', done, { once: true });
    setTimeout(done, 400);
  }
  return n;
}

function removeNode(n, animate) {
  if (animate && n.nodeType === 1 && n.hasAttribute('data-leave') && n.isConnected) {
    n.setAttribute('data-leaving', '');
    n.style.height = `${n.offsetHeight}px`;
    n.style.overflow = 'hidden';
    requestAnimationFrame(() => {
      n.classList.add('leaving');
      n.style.height = '0px';
    });
    setTimeout(() => n.remove(), 280);
  } else {
    n.remove();
  }
}

function reconcile(parent, newKids, animate) {
  const existing = [...parent.childNodes];
  const keyed = new Map();
  for (const n of existing) {
    const k = keyOf(n);
    if (k && !isLeaving(n)) keyed.set(k, n);
  }
  const used = new Set();
  let ref = live(parent.firstChild);

  for (const t of newKids) {
    const k = keyOf(t);
    if (k) {
      const node = keyed.get(k);
      if (node && sameKind(node, t)) {
        used.add(node);
        if (node !== ref) parent.insertBefore(node, ref);
        else ref = live(ref.nextSibling);
        patch(node, t, animate);
      } else {
        const n = fresh(t, animate);
        parent.insertBefore(n, ref);
        used.add(n);
      }
      continue;
    }
    while (ref && keyOf(ref)) ref = live(ref.nextSibling);
    if (ref && sameKind(ref, t)) {
      used.add(ref);
      const next = live(ref.nextSibling);
      patch(ref, t, animate);
      ref = next;
    } else {
      const n = fresh(t, false);
      parent.insertBefore(n, ref);
      used.add(n);
    }
  }
  for (const n of existing) {
    if (used.has(n) || isKeep(n) || isLeaving(n) || n.parentNode !== parent) continue;
    removeNode(n, animate);
  }
}

function syncAttrs(node, t, animate) {
  const keepState = node.hasAttribute('data-keepstate');
  for (const a of [...node.attributes]) {
    if (t.hasAttribute(a.name)) continue;
    if (a.name === 'data-leaving' || a.name === 'class') continue;
    if (keepState && (a.name === 'style' || a.name.startsWith('data-swipe'))) continue;
    node.removeAttribute(a.name);
  }
  for (const a of [...t.attributes]) {
    if (a.name === 'class') {
      const dyn = DYNAMIC_CLASSES.filter((c) => node.classList.contains(c));
      const next = [a.value, ...dyn, node.classList.contains('leaving') ? 'leaving' : ''].filter(Boolean).join(' ');
      if (node.getAttribute('class') !== next) node.setAttribute('class', next);
      continue;
    }
    if (keepState && a.name === 'style') continue;
    if (node.getAttribute(a.name) === a.value) continue;
    if (a.name === 'data-pulse' && animate && node.hasAttribute('data-pulse')) pulse(node);
    node.setAttribute(a.name, a.value);
  }
  if (!t.hasAttribute('class') && node.hasAttribute('class')) {
    const dyn = DYNAMIC_CLASSES.filter((c) => node.classList.contains(c));
    if (dyn.length) node.setAttribute('class', dyn.join(' '));
    else node.removeAttribute('class');
  }
}

function pulse(node) {
  node.classList.remove('pulse');
  void node.offsetWidth; // 強制重算，才能重新播放動畫
  node.classList.add('pulse');
  setTimeout(() => node.classList.remove('pulse'), 450);
}

const fmtInt = (v) => Math.round(v).toLocaleString('en-US');

function tween(node, to, animate) {
  cancelAnimationFrame(node._raf);
  clearTimeout(node._tweenTimer);
  const shown = Number(String(node.textContent).replace(/[^\d.-]/g, ''));
  const from = Number.isFinite(shown) ? shown : to;
  if (!animate || from === to) {
    node.textContent = fmtInt(to);
    return;
  }
  const start = performance.now();
  // 就算畫面在背景、動畫幀被暫停，也保證最後停在正確的數字
  node._tweenTimer = setTimeout(() => { cancelAnimationFrame(node._raf); node.textContent = fmtInt(to); }, NUMBER_MS + 80);
  const step = (now) => {
    const p = Math.min(1, (now - start) / NUMBER_MS);
    const eased = 1 - (1 - p) ** 3;
    node.textContent = fmtInt(from + (to - from) * eased);
    if (p < 1) node._raf = requestAnimationFrame(step);
    else node.textContent = fmtInt(to);
  };
  node._raf = requestAnimationFrame(step);
}

function patch(node, t, animate) {
  if (node.nodeType === 3) {
    if (node.nodeValue !== t.nodeValue) node.nodeValue = t.nodeValue;
    return;
  }
  if (node.nodeType !== 1) return;
  syncAttrs(node, t, animate);
  if (t.hasAttribute('data-tween')) {
    tween(node, Number(t.getAttribute('data-tween')), animate);
    return;
  }
  if (node.hasAttribute('data-static')) return;
  reconcile(node, [...t.childNodes], animate);
}
