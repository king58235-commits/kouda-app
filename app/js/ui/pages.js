// 頁面：食物庫、設定、首次使用；以及食物／套餐編輯、匯入、備份。
import { parseBackupText } from '../core/backup.js';
import { LEVEL_LABELS, MAX_QUICK_SLOTS, SOURCE_LABELS, SOURCE_TYPES } from '../core/constants.js';
import { fileStamp, fmtDateTime, fmtGram, fmtKcal } from '../core/format.js';
import { foodFromForm, presetFromForm, slotKey } from '../core/library.js';
import { searchLibrary } from '../core/search.js';
import { presetTotals } from '../core/summary.js';
import { icon, logoMark } from './icons.js';
import {
  canShareFiles, copyText, downloadText, html, shareFile,
} from './util.js';

const num = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : Number(s);
};

export function install(ctx) {
  const { app, sheet } = ctx;
  const q = (sel) => sheet.root.querySelector(sel);

  async function act(fn, { close = true, toast = true } = {}) {
    try {
      const r = await fn();
      if (toast && r?.message) ctx.toast.show(r.message, { undo: r.undoId });
      if (close) sheet.close();
      return r;
    } catch (err) {
      ctx.toast.show(err?.message || '操作失敗', { kind: 'error' });
      return null;
    }
  }

  // ================= 首次使用 =================

  function renderSetup() {
    return html`<main class="page no-bar setup">
      <div class="setup-brand"><span class="logo-tile">${logoMark(40)}</span>
        <h1>每日飲食扣打</h1></div>
      <p>第一次使用：先匯入你的初始食物清單，之後點一下就能記錄。資料只存在這支手機的瀏覽器裡，不會上傳。</p>
      <button class="btn primary" data-act="setup-import">匯入初始食物清單（選擇檔案或貼上）</button>
      <button class="btn" data-act="setup-restore">還原備份檔</button>
      <button class="btn link" data-act="setup-blank">先用空白食物庫開始</button>
      <p class="hint">初始食物清單是一個 .json 檔（開發者提供的 seed.json）。可以用 LINE Keep、雲端硬碟或 USB 傳到手機，再按上面的按鈕選檔案；也可以把檔案內容複製後貼上。</p>
    </main>`;
  }

  // ================= 食物庫 =================

  const foodNums = (f) => {
    const kcal = f.kind === 'opaque'
      ? `${LEVEL_LABELS.low} ${fmtKcal(f.kcal_low)}／${LEVEL_LABELS.normal} ${fmtKcal(f.kcal_book)}／${LEVEL_LABELS.high} ${fmtKcal(f.kcal_high)} kcal`
      : `${fmtKcal(f.kcal_book)} kcal／${f.unit}`;
    return `${kcal}・${f.protein_book == null ? '蛋白質未知' : `蛋白質 ${fmtGram(f.protein_book)} g`}`;
  };
  const foodFlags = (f) => [SOURCE_LABELS[f.source_type], f.needs_confirm ? '待確認' : null,
    app.settings.quick_slots.some((s) => s.type === 'food' && s.id === f.id) ? '在快捷格' : null].filter(Boolean);
  const foodMeta = (f) => `${foodNums(f)}・${foodFlags(f).join('・')}`;

  function foodRow(f) {
    return html`<div class="lib-row"><span class="main"><span class="name">${f.short_label}</span>
      <span class="meta">${f.full_name === f.short_label ? '' : html`${f.full_name}<br>`}${foodNums(f)}<br>${foodFlags(f).join('・')}</span></span>
      ${f.archived ? '' : html`<button class="btn soft" data-act="cell" data-type="food" data-id="${f.id}" data-opaque="${f.kind === 'opaque' ? 1 : 0}" aria-label="記入 ${f.short_label}">${icon('plus', { size: 16 })}記入</button>`}
      <button class="btn link" data-act="food-edit" data-id="${f.id}" aria-label="編輯 ${f.short_label}">編輯</button></div>`;
  }

  function presetRow(p) {
    const t = presetTotals(p, app.foods);
    const parts = p.items.map((i) => `${app.foods.get(i.food_id)?.short_label ?? '?'}×${i.qty}`).join(' + ');
    return html`<div class="lib-row"><span class="main"><span class="name"><span class="tag tag-preset">套餐</span>${p.label}</span>
      <span class="meta">${parts}＝${fmtKcal(t.kcal)} kcal・蛋白質 ${fmtGram(t.protein_known_g)} g${t.protein_unknown_count ? `（另 ${t.protein_unknown_count} 項未知）` : ''}</span></span>
      ${p.archived ? '' : html`<button class="btn soft" data-act="cell" data-type="preset" data-id="${p.id}" data-opaque="0" aria-label="記入 ${p.label}">${icon('plus', { size: 16 })}記入</button>`}
      <button class="btn link" data-act="preset-edit" data-id="${p.id}" aria-label="編輯 ${p.label}">編輯</button></div>`;
  }

  // 搜尋結果區（輸入時只更新這一塊，輸入框不會被重畫、鍵盤不會收起來）
  function libraryResults() {
    const query = ctx.libQuery ?? '';
    const searching = query.trim() !== '';
    const found = searchLibrary({ foods: app.foods, presets: app.presets, query });
    const livePresets = found.presets.filter((p) => !p.archived);
    const liveFoods = found.foods.filter((f) => !f.archived);
    const arch = [...found.foods.filter((f) => f.archived), ...found.presets.filter((p) => p.archived)];
    if (searching && !livePresets.length && !liveFoods.length && !arch.length) {
      return html`<div class="empty-state">找不到「${query.trim()}」。<br>
        <button class="btn primary" style="margin-top:10px" data-act="food-new-named" data-name="${query.trim()}">${icon('plus', { size: 18 })}新增食物「${query.trim()}」</button></div>`;
    }
    return html`
      ${livePresets.length || !searching ? html`<div class="group-title">套餐</div>
        <div class="list">${livePresets.map(presetRow)}${livePresets.length ? '' : html`<div class="empty-state">還沒有套餐</div>`}</div>` : ''}
      ${liveFoods.length || !searching ? html`<div class="group-title">食物</div>
        <div class="list">${liveFoods.map(foodRow)}${liveFoods.length ? '' : html`<div class="empty-state">還沒有食物，先按「新增食物」或到設定匯入。</div>`}</div>` : ''}
      ${arch.length ? html`<div class="group-title">已封存</div><div class="list">${arch.map((x) => (x.items ? presetRow(x) : foodRow(x)))}</div>` : ''}`;
  }

  function renderLibrary() {
    return html`<main class="page no-bar">
      <header class="page-head"><button class="icon-btn" data-act="go-home" aria-label="回首頁">${icon('back')}</button><h1>食物庫</h1></header>
      <div class="search"><span class="s-ico">${icon('search', { size: 20 })}</span>
        <input type="search" id="lib-search" data-role="lib-search" value="${ctx.libQuery ?? ''}" placeholder="搜尋食物或套餐（例如：拿鐵）" autocomplete="off" enterkeyhint="search" aria-label="搜尋食物或套餐">
      </div>
      <div class="btn-row"><button class="btn primary" data-act="food-new">${icon('plus', { size: 18 })}新增食物</button><button class="btn" data-act="preset-new">${icon('plus', { size: 18 })}新增套餐</button></div>
      <p class="hint" style="margin-top:8px">改食物的數值只影響之後的紀錄，已記下的不會變。快捷格最多 ${MAX_QUICK_SLOTS} 格，排列在「設定」。</p>
      <div id="lib-results">${libraryResults()}</div>
    </main>`;
  }

  // ================= 食物編輯 =================

  function foodEditor(id = null, prefill = {}) {
    const f = id ? app.foods.get(id) : null;
    const inQuick = f ? app.settings.quick_slots.some((s) => s.type === 'food' && s.id === f.id) : false;
    const v = f ?? { kind: 'single', unit: '份', source_type: 'rough', needs_confirm: false };
    sheet.show({
      title: f ? `編輯：${f.short_label}` : '新增食物',
      body: html`
        <div class="field"><label for="fe-short">按鈕上的短名稱（5 個字內最清楚）</label><input type="text" id="fe-short" maxlength="8" value="${f?.short_label ?? prefill.short_label ?? ''}"></div>
        <div class="field"><label for="fe-full">完整名稱（給 GPT 看）</label><input type="text" id="fe-full" maxlength="60" value="${f?.full_name ?? prefill.full_name ?? ''}"></div>
        <div class="field-row">
          <div class="field"><label for="fe-kind">類型</label><select id="fe-kind" data-role="fe-kind">
            <option value="single" ${v.kind === 'single' ? 'selected' : ''}>單品</option>
            <option value="opaque" ${v.kind === 'opaque' ? 'selected' : ''}>整餐模板（偏少／一般／偏多）</option></select></div>
          <div class="field"><label for="fe-unit">單位</label><input type="text" id="fe-unit" maxlength="6" value="${v.unit}"></div>
        </div>
        <div class="field"><label for="fe-kcal"><span id="fe-kcal-lbl">${v.kind === 'opaque' ? '熱量 kcal（一般）' : '熱量 kcal／份'}</span></label>
          <input type="number" id="fe-kcal" inputmode="numeric" step="any" min="0" value="${f?.kcal_book ?? ''}"></div>
        <div class="field-row" id="fe-opaque" ${v.kind === 'opaque' ? '' : 'hidden'}>
          <div class="field"><label for="fe-low">偏少 kcal</label><input type="number" id="fe-low" inputmode="numeric" step="any" min="0" value="${f?.kcal_low ?? ''}"></div>
          <div class="field"><label for="fe-high">偏多 kcal</label><input type="number" id="fe-high" inputmode="numeric" step="any" min="0" value="${f?.kcal_high ?? ''}"></div>
        </div>
        <div class="field"><label for="fe-protein">蛋白質 g／份（留空＝未知，不會算成 0）</label>
          <input type="number" id="fe-protein" inputmode="decimal" step="any" min="0" value="${f?.protein_book ?? ''}"></div>
        <div class="field"><label for="fe-src">數值來源</label><select id="fe-src">
          ${SOURCE_TYPES.map((s) => html`<option value="${s}" ${v.source_type === s ? 'selected' : ''}>${SOURCE_LABELS[s]}</option>`)}</select></div>
        <div class="field"><label for="fe-note">來源說明</label><input type="text" id="fe-note" maxlength="200" value="${f?.source_note ?? ''}" placeholder="例如：包裝標示 2026/10"></div>
        <label class="checkline"><input type="checkbox" id="fe-confirm" ${v.needs_confirm ? 'checked' : ''}> 標記為「待確認」估值</label>
        <label class="checkline"><input type="checkbox" id="fe-quick" ${inQuick ? 'checked' : ''}> 放在首頁快捷格</label>
        <div class="btn-row"><button class="btn primary" data-act="food-save" data-id="${f?.id ?? ''}">儲存</button>
          ${f ? html`<button class="btn danger" data-act="food-archive" data-id="${f.id}">${f.archived ? '還原' : '封存'}</button>` : ''}</div>
        <p class="hint">改了數值只影響之後的紀錄；已記下的不會變。食物不會被刪除，只能封存。</p>`,
    });
  }

  function readFoodForm() {
    return {
      short_label: q('#fe-short').value, full_name: q('#fe-full').value, kind: q('#fe-kind').value, unit: q('#fe-unit').value,
      kcal_book: q('#fe-kcal').value, kcal_low: q('#fe-low').value, kcal_high: q('#fe-high').value,
      protein_book: q('#fe-protein').value, source_type: q('#fe-src').value, source_note: q('#fe-note').value,
      needs_confirm: q('#fe-confirm').checked,
    };
  }

  async function saveFood(id) {
    const existing = id ? app.foods.get(id) : null;
    const { food, errors } = foodFromForm(readFoodForm(), existing, app.now());
    if (errors.length) { ctx.toast.show(errors[0], { kind: 'error' }); return; }
    const wantQuick = q('#fe-quick').checked;
    const had = app.settings.quick_slots.some((s) => s.type === 'food' && s.id === food.id);
    const r = await act(async () => {
      await app.saveFood(food);
      if (wantQuick && !had) await app.addQuickSlot({ type: 'food', id: food.id });
      if (!wantQuick && had) await app.removeQuickSlot({ type: 'food', id: food.id });
      return { message: `已儲存 ${food.short_label}` };
    });
    if (r) ctx.render();
  }

  async function archiveFood(id) {
    const f = app.foods.get(id);
    if (!f.archived) {
      const refs = app.foodReferences(id);
      const lines = [];
      if (refs.presets.length) lines.push(`套餐「${refs.presets.map((p) => p.label).join('、')}」裡還有它（套餐仍可使用，但會提醒含已封存食物）`);
      if (refs.inQuickSlots) lines.push('它會從首頁快捷格移除');
      if (lines.length && !window.confirm(`封存「${f.short_label}」：\n${lines.join('\n')}\n\n確定封存？`)) return;
    }
    await act(() => app.archiveFood(id, !f.archived));
  }

  // ================= 套餐編輯 =================

  function presetEditor(id = null) {
    const p = id ? app.presets.get(id) : null;
    ctx.presetDraft = { id: p?.id ?? null, label: p?.label ?? '', items: p ? p.items.map((i) => ({ ...i })) : [{ food_id: '', qty: 1 }] };
    renderPresetEditor();
  }

  function syncPresetDraft() {
    const d = ctx.presetDraft;
    if (!q('#pe-label')) return;
    d.label = q('#pe-label').value;
    d.items = [...sheet.root.querySelectorAll('[data-pe-row]')].map((row) => ({
      food_id: row.querySelector('select').value, qty: row.querySelector('input').value,
    }));
  }

  function renderPresetEditor() {
    const d = ctx.presetDraft;
    const existing = d.id ? app.presets.get(d.id) : null;
    const options = [...app.foods.values()].filter((f) => !f.archived || d.items.some((i) => i.food_id === f.id));
    const valid = d.items.filter((i) => app.foods.has(i.food_id) && Number(i.qty) > 0).map((i) => ({ food_id: i.food_id, qty: Number(i.qty) }));
    const t = valid.length ? presetTotals({ label: d.label, items: valid }, app.foods) : null;
    sheet.show({
      title: existing ? `編輯套餐：${existing.label}` : '新增套餐',
      body: html`
        <div class="field"><label for="pe-label">套餐名稱</label><input type="text" id="pe-label" maxlength="20" value="${d.label}"></div>
        <div class="field"><span class="lbl">組成（套餐不存自己的熱量，永遠由單品現算）</span></div>
        ${d.items.map((it, i) => html`<div class="field-row" data-pe-row style="align-items:center">
          <select aria-label="食物">${[html`<option value="">選擇食物…</option>`, ...options.map((f) => html`<option value="${f.id}" ${f.id === it.food_id ? 'selected' : ''}>${f.short_label}${f.archived ? '（已封存）' : ''}</option>`)]}</select>
          <input type="number" inputmode="decimal" step="any" min="0" value="${it.qty}" aria-label="份數" style="max-width:90px">
          <button class="icon-btn" data-act="pe-remove" data-i="${i}" aria-label="移除這一項" style="flex:none">${icon('close', { size: 18 })}</button></div>`)}
        <button class="btn" data-act="pe-add">${icon('plus', { size: 18 })}新增一項</button>
        ${t ? html`<div class="msg ok">合計 ${fmtKcal(t.kcal)} kcal・蛋白質 ${fmtGram(t.protein_known_g)} g${t.protein_unknown_count ? `（另 ${t.protein_unknown_count} 項未知）` : ''}</div>` : ''}
        <div class="btn-row"><button class="btn primary" data-act="pe-save">儲存</button>
          ${existing ? html`<button class="btn danger" data-act="pe-archive" data-id="${existing.id}">${existing.archived ? '還原' : '封存'}</button>` : ''}</div>`,
    });
  }

  // ================= 設定 =================

  function slotRows() {
    const slots = app.settings.quick_slots;
    if (!slots.length) return html`<p class="hint">還沒有快捷格。按下面的「加入快捷格」。</p>`;
    return slots.map((s, i) => {
      const t = s.type === 'preset' ? app.presets.get(s.id) : app.foods.get(s.id);
      const name = t ? (t.label ?? t.short_label) : '（已不存在）';
      return html`<div class="slot-row"><span class="nm">${i + 1}. ${s.type === 'preset' ? html`<span class="tag tag-preset">套餐</span> ` : ''}${name}</span>
        <button class="icon-btn" data-act="slot-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上移">${icon('up', { size: 18 })}</button>
        <button class="icon-btn" data-act="slot-down" data-i="${i}" ${i === slots.length - 1 ? 'disabled' : ''} aria-label="下移">${icon('down', { size: 18 })}</button>
        <button class="icon-btn" data-act="slot-remove" data-i="${i}" aria-label="移出快捷格">${icon('close', { size: 18 })}</button></div>`;
    });
  }

  function renderSettings() {
    const s = app.settings;
    const last = s.last_export_at ? fmtDateTime(s.last_export_at) : '還沒備份過';
    const persisted = ctx.persisted === true ? '已要求瀏覽器盡量保留' : ctx.persisted === false ? '瀏覽器未保證保留（請定期備份）' : '未知';
    return html`<main class="page no-bar">
      <header class="page-head"><button class="icon-btn" data-act="go-home" aria-label="回首頁">${icon('back')}</button><h1>設定</h1></header>

      <section class="settings-block"><h2>每日目標與換日</h2>
        <div class="field-row">
          <div class="field"><label for="st-kcal">熱量目標 kcal</label><input type="number" id="st-kcal" inputmode="numeric" min="1" step="any" value="${s.kcal_goal_default}"></div>
          <div class="field"><label for="st-protein">蛋白質目標 g</label><input type="number" id="st-protein" inputmode="numeric" min="0" step="any" value="${s.protein_goal_default}"></div>
        </div>
        <div class="field"><label for="st-boundary">幾點算新的一天</label><select id="st-boundary">
          ${Array.from({ length: 13 }, (_, h) => html`<option value="${h}" ${h === s.day_boundary_hour ? 'selected' : ''}>${h === 0 ? '午夜 0:00（不延後）' : `凌晨 ${h}:00`}</option>`)}</select></div>
        <label class="checkline"><input type="checkbox" id="st-today" checked> 同時套用到今天（不勾選：今天維持原本的目標）</label>
        <button class="btn primary" data-act="settings-save">儲存設定</button>
        <p class="hint">改目標或換日時間，不會改動過去已記的紀錄與過去日子的目標。</p>
      </section>

      <section class="settings-block"><h2>首頁快捷格（${s.quick_slots.length}／${MAX_QUICK_SLOTS}）</h2>
        <div>${slotRows()}</div>
        <button class="btn" data-act="slot-add-open" ${s.quick_slots.length >= MAX_QUICK_SLOTS ? 'disabled' : ''}>${icon('plus', { size: 18 })}加入快捷格</button>
      </section>

      <section class="settings-block"><h2>備份與還原</h2>
        <div class="kv"><span>上次完整備份</span><span>${last}</span></div>
        <div class="btn-row"><button class="btn primary" data-act="export-download">下載備份檔</button>
          ${canShareFiles() ? html`<button class="btn" data-act="export-share">分享備份檔</button>` : ''}</div>
        <button class="btn" data-act="export-copy">複製備份文字</button>
        <div class="btn-row"><button class="btn danger" data-act="import-full">還原備份（完整取代）</button>
          <button class="btn" data-act="import-library">匯入食物庫</button></div>
        <button class="btn link" data-act="export-library">只匯出食物庫</button>
        ${app.hasPreImportSnapshot ? html`<button class="btn" data-act="restore-pre">復原到上次匯入前（${fmtDateTime(app.preImportSnapshotAt)}）</button>` : ''}
        <p class="hint">資料只存在這支手機的瀏覽器裡，不會自動同步到電腦。清除瀏覽器資料、解除安裝或換手機都會讓紀錄消失，請定期按「下載備份檔」，並把檔案存到雲端硬碟或寄給自己。</p>
      </section>

      <section class="settings-block"><h2>關於</h2>
        <div class="kv"><span>版本</span><span>${app.version}</span></div>
        <div class="kv"><span>資料保存</span><span>${persisted}</span></div>
        <div class="kv"><span>食物／套餐／紀錄</span><span>${app.foods.size}／${app.presets.size}／${app.db.entries.size}</span></div>
      </section>
    </main>`;
  }

  function slotAddSheet() {
    const used = new Set(app.settings.quick_slots.map(slotKey));
    const foods = [...app.foods.values()].filter((f) => !f.archived && !used.has(`food:${f.id}`));
    const presets = [...app.presets.values()].filter((p) => !p.archived && !used.has(`preset:${p.id}`));
    sheet.show({
      title: '加入快捷格',
      body: html`${presets.length + foods.length === 0 ? html`<p class="hint">沒有可加入的項目了。</p>` : ''}
        <div class="list">${presets.map((p) => html`<button class="row" data-act="slot-add" data-type="preset" data-id="${p.id}"><span class="main"><span class="name"><span class="tag tag-preset">套餐</span> ${p.label}</span></span></button>`)}
        ${foods.map((f) => html`<button class="row" data-act="slot-add" data-type="food" data-id="${f.id}"><span class="main"><span class="name">${f.short_label}</span><br><span class="meta">${foodMeta(f)}</span></span></button>`)}</div>`,
    });
  }

  // ================= 匯入 =================

  function runCheck() {
    const st = ctx.imp;
    st.plan = null;
    st.error = null;
    if (!st.text.trim()) return;
    const { doc, error } = parseBackupText(st.text);
    if (error) { st.error = error; return; }
    st.plan = app.planImport(doc, st.mode, { applySettings: st.first ? true : st.applySettings });
  }

  function importSheet({ mode, first = false }) {
    ctx.imp = { mode, first, text: '', plan: null, error: null, applySettings: false, ack: false, backedUp: false, busy: false };
    renderImport();
  }

  function renderImport() {
    const st = ctx.imp;
    const plan = st.plan;
    const full = st.mode === 'replace_all';
    const title = st.first ? '匯入初始食物清單' : full ? '還原備份（完整取代）' : '匯入食物庫';
    const canApply = plan?.ok && !st.busy && (!full || st.ack);
    const sm = plan?.summary;
    sheet.show({
      title,
      body: html`
        ${full ? html`<div class="msg warn"><b>完整取代會把這支手機上的食物庫、套餐、設定與所有紀錄換成備份檔的內容。</b>建議先下載目前的備份。</div>`
          : html`<p class="hint">${st.first ? '選擇 seed.json，或把內容貼在下面。' : '依代號新增或取代食物與套餐；本機其他食物與所有紀錄都不會動。'}</p>`}
        <div class="field"><span class="lbl">選擇檔案</span><input type="file" id="imp-file" data-role="imp-file" class="ta"></div>
        <div class="field"><label for="imp-text">或貼上檔案內容</label><textarea id="imp-text" data-role="imp-text" rows="4" placeholder="{ &quot;format&quot;: &quot;kouda-backup&quot;, ...">${st.text}</textarea></div>
        ${st.error ? html`<div class="msg err">${st.error}</div>` : ''}
        ${plan && !plan.ok ? html`<div class="msg err"><b>檢查沒通過，不能匯入：</b><ul>${plan.errors.slice(0, 8).map((e) => html`<li>${e}</li>`)}</ul>${plan.errors.length > 8 ? `…另有 ${plan.errors.length - 8} 項` : ''}</div>` : ''}
        ${plan?.ok ? html`<div class="msg ok"><b>檢查通過，匯入後會變成：</b><ul>
          <li>食物：新增 ${sm.foods.add}、更新 ${sm.foods.update}、相同 ${sm.foods.same}</li>
          <li>套餐：新增 ${sm.presets.add}、更新 ${sm.presets.update}、相同 ${sm.presets.same}</li>
          ${full ? html`<li>紀錄 ${sm.entries.incoming} 筆（目前這支手機有 ${sm.entries.current} 筆）、每日目標 ${sm.days.incoming} 天</li>
            ${sm.backupCreatedAt ? html`<li>備份建立時間：${fmtDateTime(sm.backupCreatedAt)}</li>` : ''}`
            : html`<li>設定（目標、換日、快捷格）：${sm.applySettings ? '會套用檔案裡的設定' : '不變'}</li>`}
        </ul></div>` : ''}
        ${plan?.warnings.length ? html`<div class="msg warn"><ul>${plan.warnings.slice(0, 6).map((w) => html`<li>${w}</li>`)}</ul></div>` : ''}
        ${!full && !st.first && plan?.ok ? html`<label class="checkline"><input type="checkbox" data-act="imp-settings" ${st.applySettings ? 'checked' : ''}> 同時套用檔案裡的設定（目標、換日時間、快捷格）</label>` : ''}
        ${full ? html`<button class="btn" data-act="imp-backup-first">${st.backedUp ? html`${icon('check', { size: 18 })}已下載目前備份` : '先下載目前備份'}</button>
          <label class="checkline"><input type="checkbox" data-act="imp-ack" ${st.ack ? 'checked' : ''}> 我了解取代後，這支手機現有的資料會被備份檔取代</label>` : ''}
        <button class="btn ${full ? 'danger' : 'primary'}" data-act="imp-apply" ${canApply ? '' : 'disabled'}>${full ? '確認完整取代' : st.first ? '匯入並開始使用' : '確認匯入'}</button>`,
    });
  }

  // ================= 備份 =================

  const backupName = (scope) => `kouda-${scope === 'full' ? 'backup' : 'library'}-${fileStamp(app.now())}.json`;
  const backupFilePrefix = 'kouda-backup-';

  async function exportFile(scope = 'full', how = 'download') {
    const { text } = await app.exportBackup(scope);
    const name = scope === 'full' ? `${backupFilePrefix}${fileStamp(app.now())}.json` : backupName(scope);
    if (how === 'copy') {
      const ok = await copyText(text);
      ctx.toast.show(ok ? '已複製備份文字。請貼到筆記或訊息裡自己保存。' : '無法複製，請改用「下載備份檔」', { kind: ok ? 'info' : 'error' });
    } else if (how === 'share') {
      const ok = await shareFile(name, text);
      if (!ok) { downloadText(name, text); ctx.toast.show(`無法開啟分享，已改成下載：${name}`); } else ctx.toast.show('已送出分享');
    } else {
      downloadText(name, text);
      ctx.toast.show(scope === 'full' ? `已下載備份檔：${name}。請存到雲端硬碟或寄給自己。` : `已下載食物庫：${name}`);
    }
    ctx.render();
  }

  const guard = (fn) => async (...a) => {
    try { await fn(...a); } catch (err) { ctx.toast.show(err?.message || '操作失敗', { kind: 'error' }); }
  };

  const acts = {
    'setup-import': () => importSheet({ mode: 'library_only', first: true }),
    'setup-restore': () => importSheet({ mode: 'replace_all' }),
    'setup-blank': guard(async () => { await app.startBlank(); ctx.render(); }),

    'food-new': () => foodEditor(null),
    'food-new-named': (el) => foodEditor(null, { short_label: [...el.dataset.name].slice(0, 8).join(''), full_name: el.dataset.name }),
    'food-edit': (el) => foodEditor(el.dataset.id),
    'food-save': guard((el) => saveFood(el.dataset.id || null)),
    'food-archive': guard((el) => archiveFood(el.dataset.id).then(() => ctx.render())),
    'preset-new': () => presetEditor(null),
    'preset-edit': (el) => presetEditor(el.dataset.id),
    'pe-add': () => { syncPresetDraft(); ctx.presetDraft.items.push({ food_id: '', qty: 1 }); renderPresetEditor(); },
    'pe-remove': (el) => { syncPresetDraft(); ctx.presetDraft.items.splice(Number(el.dataset.i), 1); renderPresetEditor(); },
    'pe-save': guard(async () => {
      syncPresetDraft();
      const d = ctx.presetDraft;
      const existing = d.id ? app.presets.get(d.id) : null;
      const { preset, errors } = presetFromForm({ label: d.label, items: d.items, source_note: existing?.source_note }, existing, app.foods, app.now());
      if (errors.length) { ctx.toast.show(errors[0], { kind: 'error' }); return; }
      if (await act(() => app.savePreset(preset))) ctx.render();
    }),
    'pe-archive': guard(async (el) => {
      const p = app.presets.get(el.dataset.id);
      if (await act(() => app.archivePreset(p.id, !p.archived))) ctx.render();
    }),

    'settings-save': guard(async () => {
      const kcal = Number(document.getElementById('st-kcal').value);
      const protein = Number(document.getElementById('st-protein').value);
      const boundary = Number(document.getElementById('st-boundary').value);
      const r = await app.saveSettings({ kcal_goal_default: kcal, protein_goal_default: protein, day_boundary_hour: boundary },
        { applyToToday: document.getElementById('st-today').checked });
      ctx.toast.show(r.message);
      ctx.render();
    }),
    'slot-up': guard(async (el) => { await app.moveQuickSlot(Number(el.dataset.i), -1); }),
    'slot-down': guard(async (el) => { await app.moveQuickSlot(Number(el.dataset.i), 1); }),
    'slot-remove': guard(async (el) => {
      const slot = app.settings.quick_slots[Number(el.dataset.i)];
      await app.removeQuickSlot(slot);
    }),
    'slot-add-open': () => slotAddSheet(),
    'slot-add': guard(async (el) => {
      if (await act(() => app.addQuickSlot({ type: el.dataset.type, id: el.dataset.id }))) ctx.render();
    }),

    'backup-now': guard(() => exportFile('full', 'download')),
    'backup-snooze': guard(async () => { await app.snoozeBackupReminder(1); }),
    'export-download': guard(() => exportFile('full', 'download')),
    'export-share': guard(() => exportFile('full', 'share')),
    'export-copy': guard(() => exportFile('full', 'copy')),
    'export-library': guard(() => exportFile('library', 'download')),
    'import-full': () => importSheet({ mode: 'replace_all' }),
    'import-library': () => importSheet({ mode: 'library_only' }),
    'restore-pre': guard(async () => {
      if (!window.confirm('復原到上次匯入前的資料？目前的資料會先被存成新的「匯入前快照」，之後還能再切換回來。')) return;
      await app.restorePreImport();
      ctx.toast.show('已復原到上次匯入前');
      ctx.render();
    }),

    'imp-settings': (el) => { ctx.imp.applySettings = el.checked; runCheck(); renderImport(); },
    'imp-ack': (el) => { ctx.imp.ack = el.checked; renderImport(); },
    'imp-backup-first': guard(async () => {
      await exportFile('full', 'download');
      ctx.imp.backedUp = true;
      renderImport();
    }),
    'imp-apply': guard(async (el) => {
      const st = ctx.imp;
      if (!st.plan?.ok || st.busy) return;
      st.busy = true;
      el.disabled = true;
      try {
        const r = await app.applyImport(st.plan);
        sheet.close();
        ctx.toast.show(r.message);
        ctx.afterImport?.();
        ctx.render();
      } finally {
        st.busy = false;
      }
    }),
  };

  const inputs = {
    'lib-search': (el) => {
      ctx.libQuery = el.value;
      const box = document.getElementById('lib-results');
      if (box) box.innerHTML = libraryResults().s;
    },
    'imp-text': (el) => {
      ctx.imp.text = el.value;
      clearTimeout(ctx.impTimer);
      ctx.impTimer = setTimeout(() => { runCheck(); renderImport(); }, 400);
    },
    'fe-kind': (el) => {
      const opaque = el.value === 'opaque';
      q('#fe-opaque').hidden = !opaque;
      q('#fe-kcal-lbl').textContent = opaque ? '熱量 kcal（一般）' : '熱量 kcal／份';
    },
  };

  const changes = {
    'imp-file': async (el) => {
      const file = el.files?.[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { ctx.imp.error = '檔案太大（超過 20 MB），不像是備份檔'; renderImport(); return; }
      ctx.imp.text = await file.text();
      runCheck();
      renderImport();
    },
  };

  return { acts, inputs, changes, renderSetup, renderLibrary, renderSettings };
}
