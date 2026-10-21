// 畫面總成：路由、事件委派、長按快捷格、重新繪製。
import { renderHome } from './home.js';
import { install as installPages } from './pages.js';
import { install as installSheets } from './sheets.js';
import { createSheetManager, createToaster, esc } from './util.js';

const LONG_PRESS_MS = 550;

export function mountUI(app, { onReload = () => location.reload() } = {}) {
  const root = document.getElementById('app');
  const ctx = {
    app,
    expanded: new Set(),
    updateReady: false,
    persisted: undefined,
    copyState: { question: 'dinner', extra: '' },
    paste: { text: '', parsed: null, busy: false },
    imp: null,
    presetDraft: null,
    suppressClick: false,
  };
  ctx.toast = createToaster(document.getElementById('toast-root'));
  ctx.sheet = createSheetManager(document.getElementById('sheet-root'));

  const S = installSheets(ctx);
  const P = installPages(ctx);

  const route = () => {
    if (app.needsSetup) return 'setup';
    const h = location.hash;
    if (h === '#/library') return 'library';
    if (h === '#/settings') return 'settings';
    return 'home';
  };

  function render() {
    const y = window.scrollY;
    const r = route();
    let view;
    if (r === 'setup') view = P.renderSetup();
    else if (r === 'library') view = P.renderLibrary();
    else if (r === 'settings') view = P.renderSettings();
    else view = renderHome(ctx);
    root.innerHTML = view.s;
    document.body.dataset.route = r;
    window.scrollTo(0, y);
  }
  ctx.render = render;
  ctx.go = (hash) => { location.hash = hash; };
  ctx.afterImport = () => requestPersist();

  async function requestPersist() {
    try {
      if (navigator.storage?.persist) {
        ctx.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      }
    } catch { /* 不支援就略過；備份仍是主要保障 */ }
    if (route() === 'settings') render();
  }

  async function guarded(fn) {
    try {
      return await fn();
    } catch (err) {
      ctx.toast.show(err?.message || '操作失敗', { kind: 'error' });
      return null;
    }
  }

  async function quickAdd(el) {
    const { type, id, opaque } = el.dataset;
    if (type === 'preset') {
      const r = await app.quickAddPreset(id);
      ctx.toast.show(`${r.message}${r.warnings.length ? `（${r.warnings[0]}）` : ''}`, { undo: r.undoId });
    } else if (opaque === '1') {
      S.levelSheet(id);
    } else {
      const r = await app.quickAddFood(id);
      ctx.toast.show(r.message, { undo: r.undoId });
    }
  }

  const acts = {
    ...S.acts,
    ...P.acts,
    'sheet-close': () => ctx.sheet.close(),
    'toast-undo': async (el) => {
      const ok = await app.undo(el.dataset.undo);
      ctx.toast.show(ok ? '已撤銷' : '這個動作已經不能撤銷');
    },
    'go-home': () => ctx.go('#/'),
    'go-library': () => ctx.go('#/library'),
    'go-settings': () => ctx.go('#/settings'),
    'day-prev': () => app.shiftWorkingDay(-1),
    'day-next': () => app.shiftWorkingDay(1),
    'set-day': (el) => app.setWorkingDay(el.dataset.day),
    cell: quickAdd,
    'toggle-group': (el) => {
      const id = el.dataset.id;
      if (ctx.expanded.has(id)) ctx.expanded.delete(id);
      else ctx.expanded.add(id);
      render();
    },
    'reload-app': onReload,
  };
  const inputs = { ...S.inputs, ...P.inputs };
  const changes = { ...P.changes };

  document.addEventListener('click', (e) => {
    if (ctx.suppressClick) {
      ctx.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const el = e.target.closest('[data-act]');
    const fn = el && acts[el.dataset.act];
    if (!fn) return;
    guarded(() => fn(el, e));
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role=button][data-act]')) {
      e.preventDefault();
      e.target.click();
    } else if (e.key === 'Escape' && ctx.sheet.isOpen) {
      ctx.sheet.close();
    }
  });

  // 手機鍵盤跳出來後，把正在輸入的欄位捲到看得到的位置
  document.addEventListener('focusin', (e) => {
    if (!e.target.closest?.('.sheet-body')) return;
    if (!e.target.matches?.('input[type=text], input[type=number], input[type=date], textarea, select')) return;
    setTimeout(() => e.target.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 320);
  });

  document.addEventListener('input', (e) => {
    const role = e.target.dataset?.role;
    if (role && inputs[role]) inputs[role](e.target, e);
  });
  document.addEventListener('change', (e) => {
    const role = e.target.dataset?.role;
    if (role && inputs[role] && e.target.tagName === 'SELECT') inputs[role](e.target, e);
    if (role && changes[role]) guarded(() => changes[role](e.target, e));
  });

  // 長按快捷格：份數／套餐內容。放開太早就只是一般點擊。
  let press = null;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.grid .cell[data-act=cell]');
    if (!el) return;
    press = { el, x: e.clientX, y: e.clientY };
    press.timer = setTimeout(() => {
      ctx.suppressClick = true;
      setTimeout(() => { ctx.suppressClick = false; }, 700);
      const { type, id, opaque } = el.dataset;
      if (type === 'preset') S.presetSheet(id);
      else if (opaque === '1') S.levelSheet(id);
      else S.addSheet(id);
      press = null;
    }, LONG_PRESS_MS);
  });
  const cancelPress = () => {
    if (press) {
      clearTimeout(press.timer);
      press = null;
    }
  };
  document.addEventListener('pointerup', cancelPress);
  document.addEventListener('pointercancel', cancelPress);
  document.addEventListener('pointermove', (e) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancelPress();
  });
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.grid .cell')) e.preventDefault();
  });

  app.subscribe(render);
  window.addEventListener('hashchange', () => {
    if (ctx.sheet.isOpen) ctx.sheet.close();
    render();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) render();
  });
  setInterval(() => {
    if (!document.hidden && !ctx.sheet.isOpen) render();
  }, 60_000);

  render();
  requestPersist();
  return {
    ctx,
    markUpdateReady() {
      ctx.updateReady = true;
      render();
    },
  };
}

export function fatalScreen(root, err) {
  root.innerHTML = `<main class="page no-bar setup"><h1>無法啟動</h1><p>${esc(err?.message ?? String(err))}</p><p>如果是在無痕模式，請改用一般模式；或重新整理再試一次。</p></main>`;
}
