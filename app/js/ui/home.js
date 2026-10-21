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

function entryRow(e, { child = false } = {}) {
  return html`<div class="row ${child ? 'child' : ''}" role="button" tabindex="0" data-act="edit-entry" data-id="${e.id}">
    <span class="time">${fmtTime(e.created_at)}</span>
    <span class="main">
      <span class="name">${e.label_snapshot}<span class="qty">${fmtQty(e.qty)}</span></span><br>
      <span class="meta">${entryMeta(e)}</span>
    </span>
    <span class="kcal">${fmtKcal(entryKcal(e))}<small>kcal</small></span>
    <button class="more" data-act="edit-entry" data-id="${e.id}" aria-label="編輯 ${e.label_snapshot}">⋯</button>
  </div>`;
}

function groupRows(g, expanded) {
  const open = expanded.has(g.group_id);
  const kcal = g.entries.reduce((a, e) => a + entryKcal(e), 0);
  const head = g.entries[0];
  return html`<div class="row" role="button" tabindex="0" data-act="toggle-group" data-id="${g.group_id}" aria-expanded="${open}">
      <span class="time">${fmtTime(head.created_at)}</span>
      <span class="main">
        <span class="name"><span class="caret ${open ? 'open' : ''}">▸</span> ${g.label}<span class="qty">（${g.entries.length} 項）</span></span><br>
        <span class="meta">套餐・點開可改其中一項</span>
      </span>
      <span class="kcal">${fmtKcal(kcal)}<small>kcal</small></span>
      <button class="more" data-act="edit-group" data-id="${g.group_id}" aria-label="編輯套餐 ${g.label}">⋯</button>
    </div>
    ${open ? g.entries.map((e) => entryRow(e, { child: true })) : ''}`;
}

function cell(c) {
  if (c.missing) {
    return html`<button class="cell empty" disabled><span class="c-label">${c.label}</span></button>`;
  }
  const sub = c.preset ? `★ ${fmtKcal(c.kcal)} kcal` : c.opaque ? `▾ 選份量` : `${fmtKcal(c.kcal)} kcal`;
  return html`<button class="cell ${c.preset ? 'preset' : ''}" data-act="cell" data-type="${c.type}" data-id="${c.id}" data-opaque="${c.opaque ? 1 : 0}" aria-label="${c.label}，今日 ${c.count} 份">
    ${c.count ? html`<span class="c-count">×${Math.round(c.count * 100) / 100}</span>` : ''}
    ${c.needsConfirm ? html`<span class="c-flag" aria-label="待確認">待確認</span>` : ''}
    <span class="c-label">${c.label}</span>
    <span class="c-sub">${sub}</span>
  </button>`;
}

function hero(app, t, day, cur) {
  const over = t.remaining_kcal < 0;
  const label = over ? '已超過目標' : (day === cur ? '今天還剩' : `${fmtDay(day)} 還剩`);
  const num = over ? t.over_kcal : t.remaining_kcal;
  const unk = t.protein_unknown_count;
  let gap = '';
  if (t.protein_known_g >= t.protein_goal) {
    gap = unk ? html`<span class="gap ok">已知的部分已達標（另有未知項）</span>` : html`<span class="gap ok">蛋白質已達標 ✓</span>`;
  } else {
    gap = html`<span class="gap">以已知估算計，還差 ${fmtGram(t.protein_gap_known_g)} g${unk ? '（實際可能更少）' : ''}</span>`;
  }
  const chips = [];
  if (t.rough_count) chips.push(html`<span class="note-chip">含 ${t.rough_count} 筆粗估</span>`);
  if (t.gpt_count) chips.push(html`<span class="note-chip">${t.gpt_count} 筆 GPT 估算</span>`);
  if (t.needs_confirm_count) chips.push(html`<span class="note-chip warn">${t.needs_confirm_count} 筆待確認的估值</span>`);
  return html`<section class="hero ${over ? 'over' : ''}" aria-live="polite">
    <div class="hero-label">${label}</div>
    <div class="hero-num">${fmtKcal(num)}<small>kcal</small></div>
    <div class="hero-sub">已記 ${fmtKcal(t.eaten_kcal)}／目標 ${fmtKcal(t.kcal_goal)} kcal</div>
    <div class="protein">蛋白質 約 ${fmtGram(t.protein_known_g)}／${fmtGram(t.protein_goal)} g${unk ? ` ・ 另 ${unk} 項未知` : ''}${gap}</div>
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
    out.push(html`<div class="banner info"><span>🕐 ${time}・記入 <b>${fmtDay(day)}</b></span>
      <span class="btns"><button data-act="set-day" data-day="${other}">改記 ${fmtDay(other)}</button></span></div>`);
  } else if (day !== cur) {
    out.push(html`<div class="banner"><span>正在查看／補記 <b>${fmtDay(day)}</b>（不是目前的飲食日）</span>
      <span class="btns"><button data-act="set-day" data-day="${cur}">回到 ${fmtDay(cur)}</button></span></div>`);
  }
  const r = app.backupReminder();
  if (r) {
    const msg = r.kind === 'never' ? '還沒備份過資料' : `已 ${r.days} 天沒備份`;
    out.push(html`<div class="banner" title="清除瀏覽器資料會讓紀錄消失，請定期備份"><span>💾 ${msg}</span>
      <span class="btns"><button data-act="backup-now">立即備份</button><button data-act="backup-snooze">稍後</button></span></div>`);
  }
  if (ctx.updateReady) {
    out.push(html`<div class="banner info"><span>已有新版本。</span><span class="btns"><button data-act="reload-app">重新載入</button></span></div>`);
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
        <span class="daylabel">${fmtDay(day)}<span class="tag ${day === cur ? '' : 'other'}">${day === cur ? '今天' : '補記'}</span></span>
        <button class="icon-btn" data-act="day-next" aria-label="後一天" ${canNext ? '' : 'disabled'}>›</button>
      </div>
      <div class="top-actions">
        <button class="chip-btn" data-act="go-library">食物庫</button>
        <button class="icon-btn" data-act="go-settings" aria-label="設定">⚙</button>
      </div>
    </header>
    ${banners(ctx)}
    ${hero(app, t, day, cur)}
    <section class="grid" aria-label="快捷食物">
      ${grid.map(cell)}
      ${grid.length < MAX_QUICK_SLOTS ? html`<button class="cell empty" data-act="go-library"><span class="c-label">＋</span><span class="c-sub">加快捷</span></button>` : ''}
    </section>
    <div class="section-title"><span>${day === cur ? '今日已記' : `${fmtDay(day)} 已記`}</span><span>${t.entry_count} 筆</span></div>
    <section class="list" aria-label="已記清單">
      ${list.length === 0
        ? html`<div class="empty-state">還沒有紀錄。點上面的快捷食物，一下就記好。</div>`
        : list.map((r) => (r.type === 'group' ? groupRows(r, ctx.expanded) : entryRow(r.entry)))}
    </section>
  </main>
  <nav class="bar" aria-label="操作列"><div class="bar-inner">
    <button data-act="open-rough">＋ 粗估</button>
    <button data-act="open-paste">貼上 GPT</button>
    <button class="primary" data-act="open-copy">複製給 GPT</button>
  </div></nav>`;
}
