// 今日紀錄的左滑刪除（Pointer Events）。
// - 只在「水平左滑」時接手；上下捲動、點擊、長按都不受影響（列有 touch-action: pan-y）。
// - 短滑：露出「刪除」鈕；滑過長門檻再放開：直接刪除（有撤銷）。
// - 滑完不會再觸發列的點擊編輯。刪除失敗會把列滑回原位。
import { prefersReducedMotion } from './morph.js';

const OPEN_WIDTH = 88;      // 露出的刪除區寬度
const OPEN_AT = 36;         // 放開時超過這個距離就停在「露出刪除」
const MIN_DELETE = 150;     // 直接刪除的最小距離
const LOCK_SLOP = 10;       // 超過這個移動量才判斷方向
const SUPPRESS_MS = 350;

export function installSwipe(ctx, { onDelete }) {
  let st = null;
  let openRow = null;

  const dur = () => (prefersReducedMotion() ? '0s' : '.18s');

  function setX(row, x, animated) {
    row.style.transition = animated ? `transform ${dur()} ease-out` : 'none';
    row.style.transform = x === 0 ? '' : `translateX(${x}px)`;
    if (animated && x === 0) {
      const clear = () => { row.style.transition = ''; };
      row.addEventListener('transitionend', clear, { once: true });
      setTimeout(clear, 260);
    }
  }

  function closeOpen(except = null) {
    if (openRow && openRow !== except) {
      setX(openRow, 0, true);
      delete openRow.dataset.swipeOpen;
      openRow = null;
    }
  }

  function endGesture() {
    ctx.gesture = false;
    if (ctx.renderPending) {
      ctx.renderPending = false;
      ctx.render();
    }
  }

  // 滑完之後瀏覽器可能補送一個 click：只吃掉「落在這一列上」的那一個，不影響別處的點擊
  function suppressNextClick(row) {
    ctx.suppressRow = row;
    setTimeout(() => { if (ctx.suppressRow === row) ctx.suppressRow = null; }, SUPPRESS_MS);
  }

  async function deleteRow(row) {
    if (row.dataset.swipeBusy) return;
    row.dataset.swipeBusy = '1';
    const kind = row.dataset.swipeKind;
    const id = row.dataset.id;
    setX(row, -row.offsetWidth, true); // 先滑出去，成功後清單會收合移除
    try {
      await onDelete(kind, id);
      if (openRow === row) openRow = null;
    } catch (err) {
      delete row.dataset.swipeBusy;
      delete row.dataset.swipeOpen;
      if (openRow === row) openRow = null;
      setX(row, 0, true); // 失敗：滑回原位
      throw err;
    }
  }

  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const row = e.target.closest?.('.swipe-row');
    if (!row) { closeOpen(); return; }
    closeOpen(row);
    if (e.target.closest('.more') || row.dataset.swipeBusy) return;
    st = {
      row, x0: e.clientX, y0: e.clientY, id: e.pointerId, lock: null,
      base: row === openRow ? -OPEN_WIDTH : 0, x: row === openRow ? -OPEN_WIDTH : 0, width: row.offsetWidth,
    };
  }

  function onMove(e) {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x0;
    const dy = e.clientY - st.y0;
    if (!st.lock) {
      if (Math.abs(dy) > LOCK_SLOP && Math.abs(dy) > Math.abs(dx)) { st = null; return; } // 垂直捲動，不處理
      if (Math.abs(dx) > LOCK_SLOP && Math.abs(dx) > Math.abs(dy) * 1.4) {
        st.lock = 'h';
        ctx.gesture = true;
        try { st.row.setPointerCapture(e.pointerId); } catch { /* 沒有也可以 */ }
      } else return;
    }
    const raw = st.base + dx;
    st.x = raw > 0 ? raw / 6 : Math.max(raw, -st.width);
    setX(st.row, st.x, false);
  }

  function finish(e, cancelled) {
    if (!st || (e && e.pointerId !== st.id)) return;
    const s = st;
    st = null;
    if (s.lock !== 'h') return;
    try { s.row.releasePointerCapture(s.id); } catch { /* 已釋放 */ }
    suppressNextClick(s.row);
    const deleteAt = Math.max(MIN_DELETE, s.width * 0.5);
    if (!cancelled && s.x <= -deleteAt) {
      endGesture();
      deleteRow(s.row).catch((err) => ctx.toast.show(err?.message || '刪除失敗', { kind: 'error' }));
      return;
    }
    if (!cancelled && s.x <= -OPEN_AT) {
      s.row.dataset.swipeOpen = '1';
      openRow = s.row;
      setX(s.row, -OPEN_WIDTH, true);
    } else {
      delete s.row.dataset.swipeOpen;
      if (openRow === s.row) openRow = null;
      setX(s.row, 0, true);
    }
    endGesture();
  }

  document.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerup', (e) => finish(e, false), { passive: true });
  document.addEventListener('pointercancel', (e) => finish(e, true), { passive: true });
  window.addEventListener('scroll', () => closeOpen(), { passive: true });

  return {
    closeOpen,
    // 按下露出的「刪除」鈕
    deleteFromButton(btn) {
      const row = btn.closest('.swipe')?.querySelector('.swipe-row');
      if (row) return deleteRow(row);
      return Promise.resolve();
    },
  };
}
