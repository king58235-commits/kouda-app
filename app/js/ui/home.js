import { LEVEL_LABELS, MAX_QUICK_SLOTS, SOURCE_LABELS } from '../core/constants.js';
import { fmtDay, fmtGram, fmtKcal, fmtQty, fmtTime } from '../core/format.js';
import { entryKcal, entryProtein } from '../core/summary.js';
import { html } from './util.js';

function entryMeta(e) {
  const p = entryProtein(e);
  const src = `${SOURCE_LABELS[e.source_type_snapshot]}${e.needs_confirm_snapshot ? '・待確認' : ''}`;
  const level = e.level ? `${LEVEL_LABELS[e.level]}・` : '';
  return html`${level}${src} ・ ${p === null ? html`<span class="warn">蛋白質未知</span>` : `蛋白質 ${fmtGram(p)} g`}${e.note ? ` ・ ${e.note}` : ''}`;
}

function rowBody(e) {
  return html`<span class="time">${fmtTime(e.created_at)}</span>
    <span class="main">
      <span class="name">${e.label_snapshot}<span class="qty">${fmtQty(e.qty)}</span></span>
      <span class="meta">${entryMeta(e)}</span>
    </span>
    <span class="kcal">${fmtKcal(entryKcal(e))}<small>kcal</small></span>
    <button class="more" data-act="edit-entry" data-id="${e.id}" aria-label="編輯 ${e.label_snapshot}">⋯</button>`;
}

// 獨立的一筆：可左滑刪除
function entryRow(e) {
  return html`<div class="swipe" data-key="e:${e.id}" data-enter data-leave>
    <div class="swipe-bg" aria-hidden="true"><button class="swipe-del" tabindex="-1" data-act="swipe-delete" data-id="${e.id}">刪除</button></div>
    <div class="row swipe-row" role="button" tabindex="0" data-keepstate data-swipe-kind="entry" data-act="edit-entry" data-id="${e.id}">${rowBody(e)}</div>
  </div>`;
}

// 套餐群組列：可左滑刪除整組；展開後的子項沿用編輯入口
function groupRows(g, expanded) {
  const open = expanded.has(g.group_id);
  const kcal = g.entries.reduce((a, e) => a + entryKcal(e), 0);
  const head = g.entries[0];
  const children = open
    ? g.entries.map((e) => html`<div class="row child" role="button" tabindex="0" data-key="ec:${e.id}" data-enter data-leave data-act="edit-entry" data-id="${e.id}">${rowBody(e)}</div>`)
    : '';
  return html`<div class="swipe" data-key="g:${g.group_id}" data-enter data-leave>
      <div class="swipe-bg" aria-hidden="true"><button class="swipe-del" tabindex="-1" data-act="swipe-delete" data-group="1" data-id="${g.group_id}">刪除整組</button></div>
      <div class="row swipe-row" role="button" tabindex="0" data-keepstate data-swipe-kind="group" data-act="toggle-group" data-id="${g.group_id}" aria-expanded="${open}">
        <span class="time">${fmtTime(head.created_at)}</span>
        <span class="main">
          <span class="name"><span class="caret ${open ? 'open' : ''}">▸</span> ${g.label}<span class="qty">${g.entries.length} 項</span></span>
          <span class="meta"><span class="tag tag-preset">套餐</span> 點開可改其中一項</span>
        </span>
        <span class="kcal">${fmtKcal(kcal)}<small>kcal</small></span>
        <button class="more" data-act="edit-group" data-id="${g.group_id}" aria-label="編輯套餐 ${g.label}">⋯</button>
      </div>
    </div>${children}`;
}

const r2 = (x) => Math.round(x * 100) / 100;

function cell(c) {
  const key = `c:${c.type}:${c.id}`;
  if (c.missing) {
    return html`<div class="cell empty" data-key="${key}"><button class="cell-main" disabled><span class="c-label">${c.label}</span></button></div>`;
  }
  const tags = [];
  if (c.preset) tags.push(html`<span class="tag tag-preset">套餐</span>`);
  if (c.opaque) tags.push(html`<span class="tag tag-pick">選份量</span>`);
  if (c.needsConfirm) tags.push(html`<span class="tag tag-warn">待確認</span>`);
  const sub = c.opaque ? `${fmtKcal(c.kcal)} kcal 起` : `${fmtKcal(c.kcal)} kcal`;
  const extra = c.fromPreset > 0 ? `含套餐 ${r2(c.fromPreset)}` : c.fromOther > 0 ? `含其他 ${r2(c.fromOther)}` : '';
  const total = r2(c.total);
  const label = `${c.label}${total ? `，今日 ${total} 份${extra ? `（${extra}）` : ''}` : ''}`;
  return html`<div class="cell ${c.preset ? 'preset' : ''}" role="group" data-key="${key}" aria-label="${label}">
    <button class="cell-main" data-key="main" data-act="cell" data-type="${c.type}" data-id="${c.id}" data-opaque="${c.opaque ? 1 : 0}" aria-label="記入一份 ${c.label}">
      <span class="c-tags">${tags}</span>
      <span class="c-label">${c.label}</span>
      <span class="c-sub">${c.preset ? `${fmtKcal(c.kcal)} kcal` : sub}</span>
      <span class="c-foot">${total ? html`<span class="c-count" data-pulse="${total}" title="今天已記 ${total} 份">×${total}</span>${extra ? html`<span class="c-extra">${extra}</span>` : ''}` : ''}</span>
    </button>
    ${c.removable > 0 ? html`<button class="cell-minus" data-key="minus" data-act="cell-minus" data-type="${c.type}" data-id="${c.id}" aria-label="減少一份 ${c.label}（可減 ${r2(c.removable)} 份）"><span aria-hidden="true">−</span></button>` : ''}
  </div>`;
}

function meter(pct, { over = false, thin = false, kind = '' } = {}) {
  return html`<div class="meter ${thin ? 'thin' : ''}"><div class="meter-fill ${over ? 'over' : ''} ${kind}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
}

function hero(t, day, cur) {
  const over = t.remaining_kcal < 0;
  const label = over ? '已超過目標' : (day === cur ? '今天還剩' : `${fmtDay(day)} 還剩`);
  const num = over ? t.over_kcal : t.remaining_kcal;
  const unk = t.protein_unknown_count;
  const pPct = t.protein_goal > 0 ? (t.protein_known_g / t.protein_goal) * 100 : 0;
  const kPct = t.kcal_goal > 0 ? (t.eaten_kcal / t.kcal_goal) * 100 : 0;
  let gap;
  if (t.protein_known_g >= t.protein_goal) {
    gap = unk ? html`<span class="gap ok">已知的部分已達標（另有未知項）</span>` : html`<span class="gap ok">蛋白質已達標 ✓</span>`;
  } else {
    gap = html`<span class="gap">以已知估算計，還差 ${fmtGram(t.protein_gap_known_g)} g${unk ? '（實際可能更少）' : ''}</span>`;
  }
  const chips = [];
  if (t.rough_count) chips.push(html`<span class="note-chip">含 ${t.rough_count} 筆粗估</span>`);
  if (t.gpt_count) chips.push(html`<span class="note-chip">${t.gpt_count} 筆 GPT 估算</span>`);
  if (t.needs_confirm_count) chips.push(html`<span class="note-chip warn">${t.needs_confirm_count} 筆待確認的估值</span>`);
  return html`<section class="hero ${over ? 'over' : ''}" data-key="hero" aria-live="polite">
    <div class="hero-label">${label}</div>
    <div class="hero-num"><span class="num" data-tween="${num}">${fmtKcal(num)}</span><small>kcal</small></div>
    <div class="meter-wrap" role="progressbar" aria-valuemin="0" aria-valuemax="${t.kcal_goal}" aria-valuenow="${Math.round(t.eaten_kcal)}" aria-label="今日已吃佔目標">
      ${meter(kPct, { over })}
    </div>
    <div class="hero-sub">已記 ${fmtKcal(t.eaten_kcal)}／目標 ${fmtKcal(t.kcal_goal)} kcal${over ? ' ・ 超標' : ''}</div>
    <div class="protein">
      <div class="p-line">蛋白質 約 ${fmtGram(t.protein_known_g)}／${fmtGram(t.protein_goal)} g${unk ? ` ・ 另 ${unk} 項未知` : ''}</div>
      <div class="meter-wrap" role="progressbar" aria-valuemin="0" aria-valuemax="${t.protein_goal}" aria-valuenow="${Math.round(t.protein_known_g)}" aria-label="蛋白質已知進度">
        ${meter(pPct, { thin: true, kind: 'protein' })}
      </div>
      ${gap}
    </div>
    ${chips.length ? html`<div class="notes">${chips}</div>` : ''}
  </section>`;
}

function banners(ctx) {
  const { app } = ctx;
  const out = [];
  const day = app.workingDay;
  const cur = app.currentDietDay();
  const hint = app.boundaryHint();
  const time = fmtTime(app.now());
  if (hint.show && (day === hint.dietDay || day === hint.alternateDay)) {
    const other = day === hint.dietDay ? hint.alternateDay : hint.dietDay;
    out.push(html`<div class="banner info" data-key="b:hint"><span>🕐 ${time}・記入 <b>${fmtDay(day)}</b></span>
      <span class="btns"><button data-act="set-day" data-day="${other}">改記 ${fmtDay(other)}</button></span></div>`);
  } else if (day !== cur) {
    out.push(html`<div class="banner" data-key="b:day"><span>正在查看／補記 <b>${fmtDay(day)}</b>（不是目前的飲食日）</span>
      <span class="btns"><button data-act="set-day" data-day="${cur}">回到 ${fmtDay(cur)}</button></span></div>`);
  }
  const r = app.backupReminder();
  if (r) {
    const msg = r.kind === 'never' ? '還沒備份過資料' : `已 ${r.days} 天沒備份`;
    out.push(html`<div class="banner" data-key="b:backup" title="清除瀏覽器資料會讓紀錄消失，請定期備份"><span>💾 ${msg}</span>
      <span class="btns"><button data-act="backup-now">立即備份</button><button data-act="backup-snooze">稍後</button></span></div>`);
  }
  if (ctx.updateReady) {
    out.push(html`<div class="banner info" data-key="b:update"><span>已有新版本。</span><span class="btns"><button data-act="reload-app">重新載入</button></span></div>`);
  }
  return out;
}

export function renderHome(ctx) {
  const { app } = ctx;
  const day = app.workingDay;
  const cur = app.currentDietDay();
  const t = app.totals(day);
  const grid = app.quickGrid(day);
  const list = app.listView(day);
  const canNext = day < app.maxDay();

  return html`<main class="page">
    <header class="top">
      <div class="daynav">
        <button class="icon-btn" data-act="day-prev" aria-label="前一天">‹</button>
        <span class="daylabel">${fmtDay(day)}<span class="tag ${day === cur ? 'tag-today' : 'tag-warn'}">${day === cur ? '今天' : '補記'}</span></span>
        <button class="icon-btn" data-act="day-next" aria-label="後一天" ${canNext ? '' : 'disabled'}>›</button>
      </div>
      <div class="top-actions">
        <button class="chip-btn" data-act="go-library">食物庫</button>
        <button class="icon-btn" data-act="go-settings" aria-label="設定">⚙</button>
      </div>
    </header>
    ${banners(ctx)}
    ${hero(t, day, cur)}
    <section class="grid" aria-label="快捷食物">
      ${grid.map(cell)}
      ${grid.length < MAX_QUICK_SLOTS ? html`<div class="cell empty" data-key="c:add"><button class="cell-main" data-act="go-library"><span class="c-label">＋</span><span class="c-sub">加快捷</span></button></div>` : ''}
    </section>
    <div class="tools" role="group" aria-label="更多記錄方式">
      <button class="tool" data-act="open-recent"><span aria-hidden="true">🕘</span> 最近常吃</button>
      <button class="tool" data-act="open-copypast"><span aria-hidden="true">⧉</span> 複製舊餐</button>
      <button class="tool" data-act="open-compose" ${t.entry_count ? '' : 'disabled'}><span aria-hidden="true">☰</span> 組成套餐</button>
    </div>
    <div class="section-title"><span>${day === cur ? '今日已記' : `${fmtDay(day)} 已記`}</span><span>${t.entry_count} 筆 ・ 左滑可刪除</span></div>
    <section class="list" aria-label="已記清單">
      ${list.length === 0
        ? html`<div class="empty-state" data-key="empty">還沒有紀錄。點上面的快捷食物，一下就記好。</div>`
        : list.map((r) => (r.type === 'group' ? groupRows(r, ctx.expanded) : entryRow(r.entry)))}
    </section>
  </main>
  <nav class="bar" aria-label="操作列"><div class="bar-inner">
    <button data-act="open-rough"><span class="ico" aria-hidden="true">＋</span> 粗估</button>
    <button data-act="open-paste"><span class="ico" aria-hidden="true">⇩</span> 貼上 GPT</button>
    <button data-act="open-copy"><span class="ico" aria-hidden="true">⇧</span> 複製給 GPT</button>
  </div></nav>`;
}
