// 底部面板：份量、編輯紀錄、粗估、複製給 GPT、貼上 GPT。
import { LEVEL_LABELS, SOURCE_LABELS } from '../core/constants.js';
import { fmtDay, fmtGram, fmtKcal, fmtQty } from '../core/format.js';
import { QUESTIONS } from '../core/gptSummary.js';
import { addDays } from '../core/day.js';
import { hasLevels, pickLevelKcal } from '../core/ledger.js';
import { entryKcal, entryProtein, presetTotals } from '../core/summary.js';
import { copyText, html, readClipboardText } from './util.js';

const LEVELS = ['low', 'normal', 'high'];

const num = (v) => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
};

export function install(ctx) {
  const { app, sheet } = ctx;

  async function act(fn, { close = true } = {}) {
    try {
      const r = await fn();
      if (r?.message) {
        const extra = r.warnings?.length ? `（${r.warnings[0]}）` : '';
        ctx.toast.show(`${r.message}${extra}`, { undo: r.undoId });
      }
      if (close) sheet.close();
      return r;
    } catch (err) {
      ctx.toast.show(err?.message || '操作失敗', { kind: 'error' });
      return null;
    }
  }

  const q = (sel) => sheet.root.querySelector(sel);
  const chosen = (sel) => q(`${sel} .on`)?.dataset.v ?? null;

  // ---- 選份量級別（整餐模板）----

  function levelSheet(foodId) {
    const f = app.foods.get(foodId);
    if (!f) return;
    const p = f.protein_book == null ? '蛋白質未知' : `蛋白質 ${fmtGram(f.protein_book)} g（三級共用）`;
    sheet.show({
      title: `${f.short_label}：這餐的份量`,
      body: html`<div class="seg" role="group" aria-label="份量級別">
          ${LEVELS.map((lv) => html`<button data-act="add-level" data-id="${f.id}" data-level="${lv}">${LEVEL_LABELS[lv]}<small>${fmtKcal(pickLevelKcal({ low: f.kcal_low, mid: f.kcal_book, high: f.kcal_high }, lv))} kcal</small></button>`)}
        </div>
        <p class="hint">${f.full_name}。${p}。${SOURCE_LABELS[f.source_type]}${f.needs_confirm ? '・待確認' : ''}。記入後可以在清單裡改級別或份數。</p>`,
    });
  }

  // ---- 長按快捷格：選份數再記入 ----

  function addSheet(foodId) {
    const f = app.foods.get(foodId);
    if (!f) return;
    const opaque = f.kind === 'opaque';
    sheet.show({
      title: `記入 ${f.short_label}`,
      body: html`
        <div class="field"><span class="lbl">份數</span>
          <div class="seg" id="add-qty">
            ${[0.5, 1, 2].map((n) => html`<button data-act="pick" data-v="${n}" class="${n === 1 ? 'on' : ''}">${n}</button>`)}
          </div>
          <input type="number" id="add-qty-custom" inputmode="decimal" step="any" min="0" placeholder="自訂份數（例如 1.5）" aria-label="自訂份數">
        </div>
        ${opaque ? html`<div class="field"><span class="lbl">份量級別</span>
          <div class="seg" id="add-level">
            ${LEVELS.map((lv) => html`<button data-act="pick" data-v="${lv}" class="${lv === 'normal' ? 'on' : ''}">${LEVEL_LABELS[lv]}<small>${fmtKcal(pickLevelKcal({ low: f.kcal_low, mid: f.kcal_book, high: f.kcal_high }, lv))}</small></button>`)}
          </div></div>` : ''}
        <button class="btn primary" data-act="add-submit" data-id="${f.id}">記入今日</button>`,
    });
  }

  function presetSheet(presetId) {
    const p = app.presets.get(presetId);
    if (!p) return;
    const t = presetTotals(p, app.foods);
    sheet.show({
      title: p.label,
      body: html`<div class="list">${p.items.map((i) => {
        const f = app.foods.get(i.food_id);
        return html`<div class="lib-row"><span class="main"><span class="name">${f?.short_label ?? '（已不存在）'} ${fmtQty(i.qty)}</span>
          <span class="meta">${f ? `${fmtKcal(i.qty * f.kcal_book)} kcal・${f.protein_book == null ? '蛋白質未知' : `蛋白質 ${fmtGram(i.qty * f.protein_book)} g`}${f.archived ? '・已封存' : ''}` : ''}</span></span></div>`;
      })}</div>
      <p class="hint">合計 ${fmtKcal(t.kcal)} kcal・蛋白質 ${fmtGram(t.protein_known_g)} g${t.protein_unknown_count ? `（另 ${t.protein_unknown_count} 項未知）` : ''}。記入後會展開成單品，可以只改其中一項。</p>
      <button class="btn primary" data-act="preset-add" data-id="${p.id}">記入今日</button>`,
    });
  }

  // ---- 編輯一筆紀錄 ----

  function dayControls(kind, id, day) {
    return html`<div class="field"><span class="lbl">飲食日：${fmtDay(day)}</span>
      <div class="btn-row">
        <button class="btn" data-act="move-${kind}" data-id="${id}" data-day="${addDays(day, -1)}">移到前一天</button>
        <button class="btn" data-act="move-${kind}" data-id="${id}" data-day="${addDays(day, 1)}" ${addDays(day, 1) > app.maxDay() ? 'disabled' : ''}>移到後一天</button>
      </div>
      <div class="field-row"><input type="date" id="move-date" value="${day}" max="${app.maxDay()}" aria-label="選擇日期">
        <button class="btn" data-act="move-${kind}-date" data-id="${id}">移到這天</button></div>
    </div>`;
  }

  function entrySheet(id) {
    const e = app.db.entries.get(id);
    if (!e) return;
    const p = entryProtein(e);
    const editable = e.origin === 'rough' || e.origin === 'gpt';
    sheet.show({
      title: e.label_snapshot,
      body: html`
        <div class="msg ok">${e.name_snapshot}<br>
          ${fmtKcal(e.unit_kcal_snapshot)} kcal／${e.unit_snapshot} × ${fmtQty(e.qty).slice(1)} = <b>${fmtKcal(entryKcal(e))} kcal</b>・
          ${p === null ? '蛋白質未知' : `蛋白質 ${fmtGram(p)} g`}<br>
          ${SOURCE_LABELS[e.source_type_snapshot]}${e.needs_confirm_snapshot ? '・待確認' : ''}${e.group_label ? `・套餐「${e.group_label}」` : ''}
        </div>
        ${e.gpt_raw_line ? html`<div class="hint">GPT 原文：<span class="raw">${e.gpt_raw_line}</span></div>` : ''}
        <div class="field"><span class="lbl">份數</span>
          <div class="seg">
            ${[0.5, 1, 2].map((n) => html`<button data-act="entry-qty" data-id="${e.id}" data-qty="${n}" class="${n === e.qty ? 'on' : ''}">${n}</button>`)}
          </div>
          <div class="field-row"><input type="number" id="entry-qty-custom" inputmode="decimal" step="any" min="0" value="${e.qty}" aria-label="自訂份數">
            <button class="btn" data-act="entry-qty-custom" data-id="${e.id}">套用份數</button></div>
        </div>
        ${hasLevels(e) ? html`<div class="field"><span class="lbl">份量級別</span><div class="seg">
          ${LEVELS.map((lv) => html`<button data-act="entry-level" data-id="${e.id}" data-level="${lv}" class="${e.level === lv ? 'on' : ''}">${LEVEL_LABELS[lv]}<small>${fmtKcal(pickLevelKcal({ low: e.unit_kcal_low_snapshot, mid: e.unit_kcal_mid_snapshot, high: e.unit_kcal_high_snapshot }, lv))}</small></button>`)}
        </div></div>` : ''}
        ${editable ? html`<div class="field"><span class="lbl">修改內容（只改這一筆）</span>
          <input type="text" id="ev-name" value="${e.label_snapshot}" aria-label="名稱" maxlength="60">
          <div class="field-row"><input type="number" id="ev-kcal" inputmode="numeric" step="any" min="0" value="${e.unit_kcal_snapshot}" aria-label="每份熱量 kcal">
            <input type="number" id="ev-protein" inputmode="decimal" step="any" min="0" value="${p === null ? '' : e.unit_protein_snapshot}" placeholder="蛋白質（未知留空）" aria-label="每份蛋白質 g"></div>
          <input type="text" id="ev-note" value="${e.note ?? ''}" placeholder="備註" aria-label="備註" maxlength="120">
          <button class="btn" data-act="entry-values" data-id="${e.id}">儲存修改</button></div>` : ''}
        ${dayControls('entry', e.id, e.diet_day)}
        <button class="btn danger" data-act="entry-delete" data-id="${e.id}">刪除這筆</button>`,
    });
  }

  function groupSheet(gid) {
    const list = [...app.db.entries.values()].filter((x) => x.group_id === gid);
    if (!list.length) return;
    const total = list.reduce((a, x) => a + entryKcal(x), 0);
    sheet.show({
      title: `${list[0].group_label}（${list.length} 項）`,
      body: html`<p class="hint">共 ${fmtKcal(total)} kcal。要改其中一項的份數，點那一項。</p>
        <div class="list">${list.map((x) => html`<button class="row" data-act="edit-entry" data-id="${x.id}"><span class="main"><span class="name">${x.label_snapshot}<span class="qty">${fmtQty(x.qty)}</span></span></span><span class="kcal">${fmtKcal(entryKcal(x))}<small>kcal</small></span></button>`)}</div>
        ${dayControls('group', gid, list[0].diet_day)}
        <button class="btn danger" data-act="group-delete" data-id="${gid}">整組刪除</button>`,
    });
  }

  // ---- 粗估 ----

  function roughSheet(prefill = {}) {
    sheet.show({
      title: '外食粗估',
      body: html`<p class="hint">不知道精確數字也沒關係：只填熱量就能記，蛋白質不填會算「未知」，不會算成 0。</p>
        <div class="field"><label for="r-kcal">熱量 kcal</label>
          <input type="number" id="r-kcal" inputmode="numeric" step="any" min="0" value="${prefill.kcal ?? ''}" placeholder="例如 800" autofocus></div>
        <div class="field-row">
          <div class="field"><label for="r-protein">蛋白質 g（可空）</label><input type="number" id="r-protein" inputmode="decimal" step="any" min="0" placeholder="未知"></div>
          <div class="field"><label for="r-name">名稱（可不填）</label><input type="text" id="r-name" maxlength="40" value="${prefill.name ?? ''}" placeholder="外食粗估"></div>
        </div>
        <div class="field"><label for="r-note">備註（可空）</label><input type="text" id="r-note" maxlength="200" value="${prefill.note ?? ''}"></div>
        <label class="checkline"><input type="checkbox" id="r-quick"> 存成快捷食物</label>
        <button class="btn primary" data-act="rough-submit">記入今日</button>`,
    });
  }

  // ---- 複製給 GPT ----

  function copySheet() {
    const st = ctx.copyState;
    const text = app.gptSummary({ question: st.question, extra: st.extra });
    const ph = st.question === 'dinner' ? '補充，例如：想在全家吃' : st.question === 'estimate' ? '描述這餐吃了什麼' : '想問什麼';
    sheet.show({
      title: '複製給 GPT',
      body: html`<div class="seg" role="group" aria-label="提問類型">
          ${Object.entries(QUESTIONS).map(([k, label]) => html`<button data-act="copy-q" data-q="${k}" class="${st.question === k ? 'on' : ''}">${label}</button>`)}
        </div>
        <div class="field"><label for="copy-extra">${ph}</label><textarea id="copy-extra" data-role="copy-extra" rows="2" maxlength="500">${st.extra}</textarea></div>
        <div class="field"><span class="lbl">預覽（App 是唯一帳本，GPT 只負責估算與建議）</span><textarea class="preview" id="copy-preview" readonly rows="10">${text}</textarea></div>
        <button class="btn primary" data-act="copy-do">複製</button>
        <p class="hint">複製後，到 ChatGPT 貼上送出。它不會自動連線，也不會自動改你的帳本。</p>`,
    });
  }

  function refreshCopyPreview() {
    const st = ctx.copyState;
    const el = q('#copy-preview');
    if (el) el.value = app.gptSummary({ question: st.question, extra: st.extra });
  }

  // ---- 貼上 GPT ----

  function pickedKcal(it) {
    return it.hasRange ? pickLevelKcal({ low: it.kcalLow, mid: it.kcalMid, high: it.kcalHigh }, it.level ?? 'normal') : it.kcalLow;
  }

  function pasteSheet() {
    const st = ctx.paste;
    const parsed = st.parsed;
    const items = parsed?.items ?? [];
    const sel = items.filter((i) => i.selected);
    const total = sel.reduce((a, i) => a + pickedKcal(i), 0);
    const empty = parsed && items.length === 0 && parsed.rejected.length === 0;
    sheet.show({
      title: '從 GPT 加入',
      body: html`
        <p class="hint">只讀取以「@扣打」開頭的行。解析後先放進待確認清單，按「記入今日」才會寫進帳本。</p>
        <div class="btn-row"><button class="btn" data-act="paste-read">📋 讀取剪貼簿</button></div>
        <div class="field"><label for="paste-text">或在這裡貼上 GPT 的回覆</label>
          <textarea id="paste-text" data-role="paste-text" rows="4" placeholder="@扣打 餐點名稱｜熱量 600-740 kcal｜蛋白質 23 g｜備註">${st.text}</textarea></div>
        <button class="btn" data-act="paste-parse">解析</button>
        ${parsed ? html`
          ${items.map((it, i) => html`<div class="card ${it.selected ? '' : 'off'}">
            <div class="head">
              <input type="checkbox" data-act="paste-toggle" data-i="${i}" ${it.selected ? 'checked' : ''} aria-label="記入 ${it.name}">
              <div class="title"><input type="text" data-role="paste-name" data-i="${i}" value="${it.name}" maxlength="40" aria-label="名稱"></div>
            </div>
            <div class="sub">${it.hasRange ? `熱量 ${fmtKcal(it.kcalLow)}–${fmtKcal(it.kcalHigh)} kcal` : `熱量 ${fmtKcal(it.kcalLow)} kcal`}・${it.protein === null ? '蛋白質未知' : `蛋白質 ${fmtGram(it.protein)} g`}${it.note ? `・${it.note}` : ''}</div>
            ${it.hasRange ? html`<div class="seg" role="group" aria-label="份量級別">${LEVELS.map((lv) => html`<button data-act="paste-level" data-i="${i}" data-level="${lv}" class="${it.level === lv ? 'on' : ''}">${LEVEL_LABELS[lv]}<small>${fmtKcal(pickLevelKcal({ low: it.kcalLow, mid: it.kcalMid, high: it.kcalHigh }, lv))}</small></button>`)}</div>` : ''}
            ${it.duplicate ? html`<div class="msg warn">今天已經用同一行記過，可能重複（預設不勾選）。</div>` : ''}
            ${it.warnings.map((w) => html`<div class="msg warn">${w}</div>`)}
            <label class="checkline"><input type="checkbox" data-act="paste-quick" data-i="${i}" ${it.saveAsQuick ? 'checked' : ''}> 存成快捷食物</label>
            <div class="raw">原文：${it.raw}</div>
          </div>`)}
          ${parsed.rejected.length ? html`<div class="msg err"><b>${parsed.rejected.length} 行無法記入：</b><ul>
            ${parsed.rejected.map((r, i) => html`<li>第 ${r.lineNo} 行：${r.reason}<br><span class="raw">${r.raw}</span>
              <br><button class="btn link" data-act="paste-to-rough" data-i="${i}">改用「＋粗估」手動填</button></li>`)}</ul></div>` : ''}
          ${parsed.mentions.length ? html`<div class="msg warn">有 ${parsed.mentions.length} 行提到「@扣打」但不在行首，已略過。</div>` : ''}
          ${empty ? html`<div class="msg warn">沒有找到「@扣打」開頭的行。可以請 GPT 用指定格式再回一次，或改用粗估。<br>
            <button class="btn link" data-act="paste-to-rough-text">開啟粗估（原文放進備註）</button></div>` : ''}
          <button class="btn primary" data-act="paste-commit" ${sel.length === 0 || st.busy ? 'disabled' : ''}>記入今日（${sel.length} 項，約 ${fmtKcal(total)} kcal）</button>
          <p class="hint">記到：${fmtDay(parsed.dietDay)}</p>` : ''}`,
    });
  }

  const acts = {
    'edit-entry': (el) => entrySheet(el.dataset.id),
    'edit-group': (el) => groupSheet(el.dataset.id),

    'add-level': (el) => act(() => app.quickAddFood(el.dataset.id, { level: el.dataset.level })),
    'add-submit': (el) => {
      const custom = num(q('#add-qty-custom')?.value);
      const qty = custom !== null ? custom : Number(chosen('#add-qty') ?? 1);
      if (!(qty > 0)) { ctx.toast.show('份數必須大於 0', { kind: 'error' }); return null; }
      return act(() => app.quickAddFood(el.dataset.id, { qty, level: chosen('#add-level') }));
    },
    'preset-add': (el) => act(() => app.quickAddPreset(el.dataset.id)),
    pick: (el) => {
      el.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      el.classList.add('on');
      const custom = q('#add-qty-custom');
      if (custom && el.parentElement.id === 'add-qty') custom.value = '';
    },

    'entry-qty': (el) => act(() => app.setEntryQty(el.dataset.id, Number(el.dataset.qty))),
    'entry-qty-custom': (el) => act(() => app.setEntryQty(el.dataset.id, num(q('#entry-qty-custom').value))),
    'entry-level': (el) => act(() => app.setEntryLevel(el.dataset.id, el.dataset.level)),
    'entry-values': (el) => act(() => app.setEntryValues(el.dataset.id, {
      name: q('#ev-name').value,
      kcal: num(q('#ev-kcal').value),
      protein: num(q('#ev-protein').value),
      note: q('#ev-note').value,
    })),
    'entry-delete': (el) => act(() => app.removeEntry(el.dataset.id)),
    'move-entry': (el) => act(() => app.moveEntry(el.dataset.id, el.dataset.day)),
    'move-entry-date': (el) => act(() => app.moveEntry(el.dataset.id, q('#move-date').value)),
    'group-delete': (el) => act(() => app.removeGroup(el.dataset.id)),
    'move-group': (el) => act(() => app.moveGroup(el.dataset.id, el.dataset.day)),
    'move-group-date': (el) => act(() => app.moveGroup(el.dataset.id, q('#move-date').value)),

    'open-rough': () => roughSheet(),
    'rough-submit': async () => {
      const kcal = num(q('#r-kcal').value);
      if (kcal === null || Number.isNaN(kcal) || kcal < 0) { ctx.toast.show('請填熱量（0 以上的數字）', { kind: 'error' }); return; }
      const protein = num(q('#r-protein').value);
      const r = await act(() => app.addRough({
        kcal, protein: Number.isNaN(protein) ? null : protein, name: q('#r-name').value, note: q('#r-note').value,
        saveAsQuick: q('#r-quick').checked,
      }));
      if (r?.quickFull) ctx.toast.show(`${r.message}（快捷格已滿，只存進食物庫）`, { undo: r.undoId });
    },

    'open-copy': () => { ctx.copyState = { question: 'dinner', extra: '' }; copySheet(); },
    'copy-q': (el) => { ctx.copyState.question = el.dataset.q; ctx.copyState.extra = q('#copy-extra')?.value ?? ctx.copyState.extra; copySheet(); },
    'copy-do': async () => {
      const ok = await copyText(q('#copy-preview').value, q('#copy-preview'));
      ctx.toast.show(ok ? '已複製，請到 ChatGPT 貼上' : '無法自動複製，請長按預覽文字全選後複製', { kind: ok ? 'info' : 'error' });
    },

    'open-paste': () => { ctx.paste = { text: '', parsed: null, busy: false }; pasteSheet(); },
    'paste-read': async () => {
      try {
        const text = await readClipboardText();
        ctx.paste.text = text;
        ctx.paste.parsed = app.parseGpt(text);
        pasteSheet();
      } catch (err) {
        ctx.toast.show(err?.message?.includes('Document') || err?.name === 'NotAllowedError'
          ? '沒有取得剪貼簿權限，請長按下面的輸入框貼上' : (err?.message || '讀取剪貼簿失敗'), { kind: 'error' });
      }
    },
    'paste-parse': () => {
      ctx.paste.text = q('#paste-text').value;
      ctx.paste.parsed = app.parseGpt(ctx.paste.text);
      pasteSheet();
    },
    'paste-toggle': (el) => { ctx.paste.parsed.items[Number(el.dataset.i)].selected = el.checked; pasteSheet(); },
    'paste-quick': (el) => { ctx.paste.parsed.items[Number(el.dataset.i)].saveAsQuick = el.checked; },
    'paste-level': (el) => { ctx.paste.parsed.items[Number(el.dataset.i)].level = el.dataset.level; pasteSheet(); },
    'paste-to-rough': (el) => {
      const r = ctx.paste.parsed.rejected[Number(el.dataset.i)];
      roughSheet({ name: r.name ?? '', note: r.raw });
    },
    'paste-to-rough-text': () => roughSheet({ note: ctx.paste.text.slice(0, 200) }),
    'paste-commit': async (el) => {
      if (ctx.paste.busy) return;
      const items = ctx.paste.parsed.items.filter((i) => i.selected);
      if (!items.length) return;
      ctx.paste.busy = true;
      el.disabled = true;
      const r = await act(() => app.commitGpt(items));
      ctx.paste.busy = false;
      if (r?.quickFull) ctx.toast.show(`${r.message}（快捷格已滿，只存進食物庫）`, { undo: r.undoId });
      else if (!r) pasteSheet();
    },
  };

  const inputs = {
    'copy-extra': (el) => { ctx.copyState.extra = el.value; refreshCopyPreview(); },
    'paste-text': (el) => { ctx.paste.text = el.value; },
    'paste-name': (el) => { ctx.paste.parsed.items[Number(el.dataset.i)].name = el.value.trim() || ctx.paste.parsed.items[Number(el.dataset.i)].name; },
  };

  return { acts, inputs, levelSheet, addSheet, presetSheet, entrySheet, roughSheet };
}
