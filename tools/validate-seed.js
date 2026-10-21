// 用法：node tools/validate-seed.js <食物庫或種子.json>
// 檢查格式，並印出食物、套餐現算總數與快捷格排列，供人工核對。
import { readFile } from 'node:fs/promises';
import { LEVEL_LABELS, SOURCE_LABELS } from '../app/js/core/constants.js';
import { indexById } from '../app/js/core/ledger.js';
import { presetTotals } from '../app/js/core/summary.js';
import { validateLibraryDoc } from '../app/js/core/validate.js';

const path = process.argv[2];
if (!path) {
  console.error('用法：node tools/validate-seed.js <檔案.json>');
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(await readFile(path, 'utf8'));
} catch (err) {
  console.error(`讀取或解析失敗：${err.message}`);
  process.exit(1);
}

const { errors, warnings } = validateLibraryDoc(doc);
const fmtProtein = (p) => (p == null ? '未知' : `${p} g`);

if (!errors.length) {
  const foodsById = indexById(doc.foods);
  const presetsById = indexById(doc.presets);

  console.log(`\n食物 ${doc.foods.length} 項`);
  for (const f of doc.foods) {
    const kcal = f.kind === 'opaque'
      ? `${LEVEL_LABELS.low}${f.kcal_low}／${LEVEL_LABELS.normal}${f.kcal_book}／${LEVEL_LABELS.high}${f.kcal_high}`
      : `${f.kcal_book}`;
    const flags = [SOURCE_LABELS[f.source_type], f.needs_confirm ? '待確認' : null, f.archived ? '已封存' : null]
      .filter(Boolean).join('・');
    console.log(`  ${f.short_label.padEnd(5, '　')} ${kcal} kcal｜蛋白質 ${fmtProtein(f.protein_book)}｜${flags}`);
  }

  console.log(`\n套餐 ${doc.presets.length} 組（總數由單品現算）`);
  for (const p of doc.presets) {
    const t = presetTotals(p, foodsById);
    const parts = p.items.map((i) => `${foodsById.get(i.food_id).short_label}×${i.qty}`).join(' + ');
    const unknown = t.protein_unknown_count ? `（另 ${t.protein_unknown_count} 項蛋白質未知）` : '';
    console.log(`  ${p.label}：${parts} = ${t.kcal} kcal／蛋白質 ${t.protein_known_g} g${unknown}`);
  }

  if (doc.settings) {
    const s = doc.settings;
    console.log(`\n設定：熱量 ${s.kcal_goal_default} kcal｜蛋白質 ${s.protein_goal_default} g｜${s.day_boundary_hour}:00 換日`);
    console.log(`快捷格 ${s.quick_slots.length}／12（3 欄）`);
    const names = s.quick_slots.map((slot) => (slot.type === 'preset'
      ? `★${presetsById.get(slot.id).label}`
      : foodsById.get(slot.id).short_label + (foodsById.get(slot.id).kind === 'opaque' ? '▾' : '')));
    for (let i = 0; i < names.length; i += 3) console.log(`  ${names.slice(i, i + 3).map((n) => n.padEnd(6, '　')).join('')}`);
    const slotted = new Set(s.quick_slots.map((slot) => `${slot.type}:${slot.id}`));
    const rest = [
      ...doc.foods.filter((f) => !f.archived && !slotted.has(`food:${f.id}`)).map((f) => f.short_label),
      ...doc.presets.filter((p) => !p.archived && !slotted.has(`preset:${p.id}`)).map((p) => `★${p.label}`),
    ];
    console.log(`不在快捷格（放在「全部食物」）：${rest.join('、') || '無'}`);
  }
}

for (const w of warnings) console.log(`⚠ ${w}`);
for (const e of errors) console.log(`✗ ${e}`);
console.log(errors.length ? `\n檢查失敗：${errors.length} 個錯誤` : `\n檢查通過（${warnings.length} 個提醒）`);
process.exit(errors.length ? 1 : 0);
