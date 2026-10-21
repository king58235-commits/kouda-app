import { KoudaApp } from './state.js';
import { IdbRepo } from './store/idb.js';
import { fatalScreen, mountUI } from './ui/index.js';

let waitingWorker = null;
let updating = false;

// 只有使用者按下「重新載入」才換成新版本；第一次安裝或背景更新不會突然重新整理頁面
function reloadForUpdate() {
  if (waitingWorker) {
    updating = true;
    waitingWorker.postMessage('SKIP_WAITING');
  } else location.reload();
}

function registerServiceWorker(ui) {
  if (!('serviceWorker' in navigator)) return;
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!secure) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const watch = (worker) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          waitingWorker = worker;
          ui.markUpdateReady();
        }
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) {
      waitingWorker = reg.waiting;
      ui.markUpdateReady();
    }
    reg.addEventListener('updatefound', () => reg.installing && watch(reg.installing));
  }).catch(() => { /* 沒有離線快取也能用，只是離線時打不開 */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !updating) return;
    reloading = true;
    location.reload();
  });
}

async function boot() {
  const root = document.getElementById('app');
  try {
    const repo = await IdbRepo.open();
    const app = new KoudaApp(repo);
    await app.init();
    const ui = mountUI(app, { onReload: reloadForUpdate });
    window.__kouda = { app };
    registerServiceWorker(ui);
  } catch (err) {
    fatalScreen(root, err);
  }
}

boot();
