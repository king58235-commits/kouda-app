// V1.1 智慧紀錄的面板：最近／常吃、複製舊餐、從今日已記組成套餐。
import { buildItems, classifyEntries, findDuplicatePreset, findSameName, valueChanges } from '../core/compose.js';
import { MAX_QUICK_SLOTS } from '../core/constants.js';
import { daysWithEntries, snapshotDiffs, totalsOfUnits } from '../core/copy.js';
import { fmtDateTime, fmtDay, fmtGram, fmtKcal, fmtQty } from '../core/format.js';
import { newId } from '../core/ids.js';
import { entryKcal, entryProtein, presetTotals } from '../core/summary.js';
import { icon } from './icons.js';
import { html } from './util.js';

const memoIds = () => {
  const e = new Map();
  const g = new Map();
  return {
    entry: (id) => { if (!e.has(id)) e.set(id, newId()); return e.get(id); },
    group: (id) => { if (!g.has(id)) g.set(id, newId()); return g.get(id); },
  };
};

const unitKey = (u) => `${u.type}:${u.id}`;
const proteinText = (t) => `蛋白質 ${fmtGram(t.protein)} g${t.unknown ? `（另 ${t.unknown} 項未知）` : ''}`;

export function install(ctx) {
  const { app, sheet } = ctx;
  const q = (sel) => sheet.root.querySelector(sel);

  // ================= 最近／常吃 =================

  function recentSheet(tab = ctx.recentTab ?? 'recent') {
    ctx.recentTab = tab;
    const r = app.recentItems();
    const list = tab === 'frequent' ? r.frequent : r.recent;
    const room = app.settings.quick_slots.length < MAX_QUICK_SLOTS;
    const row = (it) => html`<div class="lib-row"><span class="main"><span class="name">${it.type === 'preset' ? html`<span class="tag tag-preset">套餐</span> ` : ''}${it.label}</span>
        <span class="meta">${it.type === 'preset' ? '' : `${fmtKcal(it.kcal)} kcal${it.opaque ? ' 起 ・ 選份量' : ''} ・ `}${tab === 'frequent' ? `近 30 天 ${it.uses} 次` : `最近 ${fmtDateTime(it.lastAt)}`}</span></span>
        <button class="btn soft" data-act="cell" data-type="${it.type}" data-id="${it.id}" data-opaque="${it.opaque ? 1 : 0}" aria-label="記入 ${it.label}">${icon('plus', { size: 16 })}記入</button>
        ${room ? html`<button class="btn icon-only" data-act="recent-pin" data-type="${it.type}" data-id="${it.id}" aria-label="加入快捷格 ${it.label}" title="加入首頁快捷格">${icon('pin', { size: 18 })}</button>` : ''}</div>`;
    sheet.show({
      title: '最近／常吃',
      body: html`<div class="seg" role="tablist" aria-label="排序方式">
          <button role="tab" aria-selected="${tab === 'recent'}" data-act="recent-tab" data-tab="recent" class="${tab === 'recent' ? 'on' : ''}">最近記過</button>
          <button role="tab" aria-selected="${tab === 'frequent'}" data-act="recent-tab" data-tab="frequent" class="${tab === 'frequent' ? 'on' : ''}">最常吃<small>近 30 天</small></button>
        </div>
        ${list.length
          ? html`<div class="list">${list.map(row)}</div>`
          : html`<div class="empty-state">${tab === 'recent' ? '還沒有可以列出的食物。' : '近 30 天還沒有重複記過的食物。'}</div>`}
        <p class="hint">這裡列的是「不在首頁快捷格上」、也沒有封存的食物與套餐，由你自己的紀錄推算。套餐裡的組成不會當成單品的次數。點「記入」就記到${fmtDay(app.workingDay)}；右邊的圖釘可加入快捷格。</p>`,
    });
  }

  // ================= 複製舊餐 =================

  function defaultSource(days, target) {
    return (days.find((d) => d.day < target) ?? days[0]).day;
  }

  function copyPastSheet(sourceDay = null) {
    const target = app.workingDay;
    const days = daysWithEntries([...app.db.entries.values()], target);
    if (!days.length) {
      sheet.show({ title: '複製舊餐', body: html`<div class="empty-state">還沒有其他日子的紀錄可以複製。</div>` });
      return;
    }
    const src = sourceDay ?? ctx.cp?.sourceDay ?? defaultSource(days, target);
    if (!ctx.cp || ctx.cp.sourceDay !== src) ctx.cp = { sourceDay: src, picked: new Set(), ids: memoIds(), busy: false };
    const units = app.copyUnits(src);
    const chosen = units.filter((u) => ctx.cp.picked.has(unitKey(u)));
    const totals = totalsOfUnits(chosen);
    const diffs = snapshotDiffs(chosen, app.foods);
    const count = chosen.reduce((a, u) => a + u.entries.length, 0);
    const sumKcal = chosen.length ? `約 ${fmtKcal(totals.kcal)} kcal・${proteinText({ protein: totals.protein, unknown: totals.unknown })}` : '';

    sheet.show({
      title: '複製舊餐',
      body: html`
        <p class="hint">把以前記過的餐點複製到 <b>${fmtDay(target)}</b>。用的是當時記下的熱量與蛋白質（原紀錄的快照），原紀錄不會被改動。</p>
        <div class="field"><label for="cp-day">從哪一天複製</label>
          <select id="cp-day" data-role="cp-day">${days.slice(0, 60).map((d) => html`<option value="${d.day}" ${d.day === src ? 'selected' : ''}>${fmtDay(d.day)}・${d.count} 筆・${fmtKcal(d.kcal)} kcal</option>`)}</select></div>
        <div class="btn-row"><button class="btn" data-act="cp-all">全選</button><button class="btn" data-act="cp-none">全不選</button></div>
        <div class="list pick-list">${units.map((u) => {
          const on = ctx.cp.picked.has(unitKey(u));
          const kcal = u.entries.reduce((a, e) => a + entryKcal(e), 0);
          return html`<label class="pick-row"><input type="checkbox" data-act="cp-toggle" data-k="${unitKey(u)}" ${on ? 'checked' : ''}>
            <span class="pick-main"><b>${u.type === 'group' ? html`<span class="tag tag-preset">套餐</span> ` : ''}${u.label}</b>${u.type === 'entry' ? html` <span class="qty">${fmtQty(u.entries[0].qty)}</span>` : ''}
            <small>${u.type === 'group' ? u.entries.map((e) => `${e.label_snapshot}${fmtQty(e.qty)}`).join('、') : (entryProtein(u.entries[0]) === null ? '蛋白質未知' : `蛋白質 ${fmtGram(entryProtein(u.entries[0]))} g`)}</small></span>
            <span class="kcal">${fmtKcal(kcal)}<small>kcal</small></span></label>`;
        })}</div>
        ${chosen.length ? html`<div class="msg ok">將新增 ${count} 筆到 ${fmtDay(target)}：${sumKcal}</div>` : html`<div class="hint">勾選要複製的項目。</div>`}
        ${diffs.length ? html`<div class="msg warn"><b>食物庫目前的數值和原紀錄不同，仍依原紀錄複製：</b><ul>${diffs.slice(0, 5).map((d) => html`<li>${d.label}：原 ${fmtKcal(d.was.kcal)} kcal → 現在 ${fmtKcal(d.now.kcal)} kcal</li>`)}</ul></div>` : ''}
        <button class="btn primary" data-act="cp-apply" ${chosen.length && !ctx.cp.busy ? '' : 'disabled'}>複製 ${count} 筆到 ${fmtDay(target)}</button>`,
    });
  }

  // ================= 從今日已記組成套餐 =================

  function composeRows() {
    const fm = ctx.cm.foodMap;
    return classifyEntries(app.entriesOf(), app.foods).map((c) => {
      const mapped = fm.get(c.entry.id);
      const f = mapped ? app.foods.get(mapped) : null;
      if (f && !f.archived) return { ...c, ok: true, foodId: mapped, needsFood: false, reason: null };
      return c;
    });
  }

  const pickOf = (e) => {
    if (!ctx.cm.picks.has(e.id)) ctx.cm.picks.set(e.id, { checked: false, qty: e.qty });
    return ctx.cm.picks.get(e.id);
  };

  function composeSelection() {
    return composeRows()
      .filter((r) => r.ok && pickOf(r.entry).checked)
      .map((r) => ({ entry: r.entry, foodId: r.foodId, qty: Number(pickOf(r.entry).qty) }));
  }

  function composePreviewState() {
    const picks = composeSelection();
    const label = ctx.cm.label.trim();
    const bad = picks.find((p) => !(p.qty > 0));
    if (!picks.length) return { picks, items: [], problem: '勾選要放進套餐的食物（灰色的要先「存成食物」）。' };
    if (bad) return { picks, items: [], problem: `「${bad.entry.label_snapshot}」的份數必須大於 0` };
    const items = buildItems(picks);
    const totals = presetTotals({ label, items }, app.foods);
    const dup = findDuplicatePreset(app.presets, items);
    const same = label ? findSameName(app.presets, label) : null;
    let problem = null;
    if (!label) problem = '請替套餐取個名字。';
    else if (same) problem = `已經有同名的套餐「${same.label}」。`;
    else if (dup) problem = `已經有相同內容的套餐「${dup.label}」，不重複建立。`;
    return { picks, items, totals, changes: valueChanges(picks, app.foods), problem, merged: picks.length !== items.length };
  }

  function composePreviewHtml() {
    const st = composePreviewState();
    const room = app.settings.quick_slots.length < MAX_QUICK_SLOTS;
    return html`
      ${st.totals ? html`<div class="msg ok">套餐合計 <b>${fmtKcal(st.totals.kcal)} kcal</b>・蛋白質 ${fmtGram(st.totals.protein_known_g)} g${st.totals.protein_unknown_count ? `（另 ${st.totals.protein_unknown_count} 項未知）` : ''}
        <br><small>套餐只記「食物＋份數」，熱量永遠用食物庫現在的數值計算。建立套餐不會在今天新增任何紀錄。</small></div>` : ''}
      ${st.merged ? html`<div class="msg warn">同一個食物已合併份數。</div>` : ''}
      ${st.changes?.length ? html`<div class="msg warn"><b>新套餐用的是食物庫「現在」的數值，和今天記的不同：</b><ul>${st.changes.map((c) => html`<li>${c.label}：今天記 ${fmtKcal(c.was.kcal)} kcal → 現在 ${fmtKcal(c.now.kcal)} kcal</li>`)}</ul></div>` : ''}
      ${st.problem ? html`<div class="hint" id="cm-problem">${st.problem}</div>` : ''}
      <label class="checkline"><input type="checkbox" data-act="cm-quick" ${ctx.cm.addToQuick && room ? 'checked' : ''} ${room ? '' : 'disabled'}> 加入首頁快捷格${room ? '' : `（已滿 ${MAX_QUICK_SLOTS} 格，可到「設定」整理）`}</label>
      <button class="btn primary" data-act="cm-create" ${!st.problem && st.items.length ? '' : 'disabled'}>建立套餐</button>`;
  }

  function refreshComposePreview() {
    const el = q('#cm-preview');
    if (el) el.innerHTML = composePreviewHtml().s;
  }

  function composeSheet() {
    const rows = composeRows();
    const byId = new Map(rows.map((r) => [r.entry.id, r]));
    const view = app.listView();
    const item = (r) => {
      const e = r.entry;
      const p = pickOf(e);
      const on = r.ok && p.checked;
      const pr = entryProtein(e);
      return html`<div class="pick-row ${r.ok ? '' : 'disabled'}">
        <input type="checkbox" data-act="cm-toggle" data-id="${e.id}" ${on ? 'checked' : ''} ${r.ok ? '' : 'disabled'} aria-label="放進套餐：${e.label_snapshot}">
        <span class="pick-main"><b>${e.label_snapshot}</b> <small>${r.ok ? `${fmtKcal(e.unit_kcal_snapshot)} kcal／份 ・ ${pr === null ? '蛋白質未知' : `蛋白質 ${fmtGram(e.unit_protein_snapshot)} g／份`}` : r.reason}</small></span>
        ${r.ok ? html`<input class="qty-in" type="number" inputmode="decimal" step="any" min="0" value="${p.qty}" data-role="cm-qty" data-id="${e.id}" aria-label="份數：${e.label_snapshot}">`
          : (r.needsFood ? html`<button class="btn" data-act="cm-savefood" data-id="${e.id}">存成食物</button>` : '')}
      </div>`;
    };
    const body = view.map((v) => {
      if (v.type === 'entry') return item(byId.get(v.entry.id));
      const kids = v.entries.map((e) => byId.get(e.id));
      return html`<div class="pick-group"><div class="pick-group-head"><span><span class="tag tag-preset">套餐</span> ${v.label}</span>
        <button class="btn link" data-act="cm-group" data-gid="${v.group_id}">選取整組</button></div>${kids.map(item)}</div>`;
    });
    sheet.show({
      title: '把今日已記組成套餐',
      body: html`
        <p class="hint">勾選要放進新套餐的食物。只有「食物庫裡有的食物」能放進套餐；粗估與 GPT 估算要先明確存成食物。</p>
        <div class="btn-row"><button class="btn" data-act="cm-all">全選可用的</button></div>
        <div class="list pick-list">${body}</div>
        <div class="field"><label for="cm-label">套餐名稱</label><input type="text" id="cm-label" data-role="cm-label" maxlength="20" value="${ctx.cm.label}" placeholder="例如：全家晚餐"></div>
        <div id="cm-preview" class="stack">${composePreviewHtml()}</div>`,
    });
  }

  const guard = (fn) => async (...a) => {
    try { await fn(...a); } catch (err) { ctx.toast.show(err?.message || '操作失敗', { kind: 'error' }); }
  };

  const acts = {
    'open-recent': () => recentSheet('recent'),
    'recent-tab': (el) => recentSheet(el.dataset.tab),
    'recent-pin': guard(async (el) => {
      const r = await app.addQuickSlot({ type: el.dataset.type, id: el.dataset.id });
      ctx.toast.show(r.message);
      recentSheet();
    }),

    'open-copypast': () => { ctx.cp = null; copyPastSheet(); },
    'cp-toggle': (el) => {
      const k = el.dataset.k;
      if (el.checked) ctx.cp.picked.add(k); else ctx.cp.picked.delete(k);
      copyPastSheet();
    },
    'cp-all': () => {
      app.copyUnits(ctx.cp.sourceDay).forEach((u) => ctx.cp.picked.add(unitKey(u)));
      copyPastSheet();
    },
    'cp-none': () => { ctx.cp.picked.clear(); copyPastSheet(); },
    'cp-apply': guard(async (el) => {
      const cp = ctx.cp;
      if (cp.busy || !cp.picked.size) return;
      cp.busy = true;
      el.disabled = true;
      try {
        const selection = [...cp.picked].map((k) => {
          const i = k.indexOf(':');
          return { type: k.slice(0, i), id: k.slice(i + 1) };
        });
        const r = await app.copyFromDay({ sourceDay: cp.sourceDay, selection, ids: cp.ids });
        sheet.close();
        ctx.toast.show(r.message, { undo: r.undoId });
      } catch (err) {
        cp.busy = false;
        copyPastSheet();
        throw err;
      }
      cp.busy = false;
    }),

    'open-compose': () => {
      ctx.cm = { label: '', addToQuick: true, picks: new Map(), foodMap: new Map() };
      composeSheet();
    },
    'cm-toggle': (el) => { pickOf(app.db.entries.get(el.dataset.id)).checked = el.checked; composeSheet(); },
    'cm-group': (el) => {
      const kids = composeRows().filter((r) => r.ok && r.entry.group_id === el.dataset.gid);
      const allOn = kids.length > 0 && kids.every((r) => pickOf(r.entry).checked);
      kids.forEach((r) => { pickOf(r.entry).checked = !allOn; });
      composeSheet();
    },
    'cm-all': () => { composeRows().filter((r) => r.ok).forEach((r) => { pickOf(r.entry).checked = true; }); composeSheet(); },
    'cm-quick': (el) => { ctx.cm.addToQuick = el.checked; },
    'cm-savefood': guard(async (el) => {
      const r = await app.saveEntryAsFood(el.dataset.id);
      ctx.cm.foodMap.set(el.dataset.id, r.foodId);
      pickOf(app.db.entries.get(el.dataset.id)).checked = true;
      ctx.toast.show(r.message, { undo: r.undoId });
      composeSheet();
    }),
    'cm-create': guard(async (el) => {
      const st = composePreviewState();
      if (st.problem || !st.items.length) return;
      el.disabled = true;
      try {
        const r = await app.createPresetFromEntries({ label: ctx.cm.label, items: st.items, addToQuick: ctx.cm.addToQuick });
        sheet.close();
        ctx.toast.show(r.quickFull ? `${r.message}（快捷格已滿，沒有放上去）` : r.message, { undo: r.undoId });
      } catch (err) {
        composeSheet();
        throw err;
      }
    }),
  };

  const inputs = {
    'cp-day': (el) => { copyPastSheet(el.value); },
    'cm-qty': (el) => {
      const e = app.db.entries.get(el.dataset.id);
      if (e) pickOf(e).qty = el.value === '' ? 0 : Number(el.value);
      refreshComposePreview();
    },
    'cm-label': (el) => { ctx.cm.label = el.value; refreshComposePreview(); },
  };

  return { acts, inputs, recentSheet, copyPastSheet, composeSheet };
}
