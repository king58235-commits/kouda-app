// App → GPT：把當日帳本整理成一段可貼進 ChatGPT 的文字。
// App 與 ChatGPT 之間沒有任何自動連線；這段文字只是「複製貼上」，不代表已同步。
import { SOURCE_LABELS, LEVEL_LABELS } from './constants.js';
import { fmtDay, fmtGram, fmtKcal, fmtQty, fmtTime } from './format.js';
import { entryKcal, entryProtein } from './summary.js';

export const QUESTIONS = {
  dinner: '晚餐建議',
  estimate: '估算這餐',
  free: '自由提問',
};

export const REPLY_FORMAT_LINE = '@扣打 餐點完整名稱｜熱量 低-高 kcal｜蛋白質 數字 g（未知寫「未知」）｜備註';

function entryLine(e) {
  const kcal = entryKcal(e);
  const protein = entryProtein(e);
  const name = e.name_snapshot;
  const parts = [`${fmtTime(e.created_at)} ${name} ${fmtQty(e.qty)}${e.level ? `（${LEVEL_LABELS[e.level]}）` : ''}`];
  let kcalText = `${fmtKcal(kcal)} kcal`;
  if (e.unit_kcal_low_snapshot != null && e.unit_kcal_high_snapshot != null) {
    kcalText += `（範圍 ${fmtKcal(e.qty * e.unit_kcal_low_snapshot)}–${fmtKcal(e.qty * e.unit_kcal_high_snapshot)}）`;
  }
  parts.push(kcalText);
  parts.push(protein === null ? '蛋白質 未知' : `蛋白質 ${fmtGram(protein)} g`);
  parts.push(SOURCE_LABELS[e.source_type_snapshot] + (e.needs_confirm_snapshot ? '・待確認' : ''));
  if (e.group_label) parts.push(`〔${e.group_label}〕`);
  if (e.note) parts.push(`備註：${e.note}`);
  return parts.join('｜');
}

function questionText(question, extra) {
  const more = (extra ?? '').trim();
  if (question === 'dinner') {
    return `問題：晚餐建議。請依上面的剩餘熱量與蛋白質缺口，給我 2–3 個可選組合，附估算熱量與蛋白質。這些是建議，我還沒吃。${more ? `\n補充：${more}` : ''}`;
  }
  if (question === 'estimate') {
    return `問題：幫我估算這餐：${more || '（請在這裡描述餐點，或附上照片）'}。請給熱量與蛋白質的範圍，並說明主要假設。`;
  }
  return `問題：${more || '（請在這裡輸入你的問題）'}`;
}

export function buildSummary({ now, dietDay, totals, entries, question = 'dinner', extra = '', isCurrentDay = true }) {
  const list = entries
    .filter((e) => e.diet_day === dietDay)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

  const head = `【飲食扣打｜飲食日 ${fmtDay(dietDay)}${isCurrentDay ? '' : '（補記／查看，不是目前的飲食日）'}｜現在 ${fmtTime(now)}】`;
  const remaining = totals.remaining_kcal >= 0
    ? `剩餘 ${fmtKcal(totals.remaining_kcal)} kcal`
    : `超過 ${fmtKcal(totals.over_kcal)} kcal`;
  const proteinLine = totals.protein_unknown_count > 0
    ? `蛋白質 已記錄估算約 ${fmtGram(totals.protein_known_g)} g／目標 ${fmtGram(totals.protein_goal)} g｜另有 ${totals.protein_unknown_count} 項蛋白質未知（未計入）`
    : `蛋白質 已記錄估算約 ${fmtGram(totals.protein_known_g)} g／目標 ${fmtGram(totals.protein_goal)} g`;

  const lines = [
    head,
    `目標 ${fmtKcal(totals.kcal_goal)} kcal｜已記 ${fmtKcal(totals.eaten_kcal)} kcal｜${remaining}`,
    proteinLine,
    '※ 以下是 App 帳本（唯一帳本）。請沿用這些累計與剩餘數字，不要在 GPT 另立帳本，也不要重新加總；若某項估值明顯有問題，請指出並建議修正，但 App 不會因此自動修改。',
    '',
    list.length ? `今日已記（${list.length} 筆）：` : '今日還沒有任何紀錄。',
    ...list.map(entryLine),
    '',
    questionText(question, extra),
    '',
    '【回覆格式】',
    '- 一般建議或候選方案，請用普通文字列出估算，不要加 @扣打（候選還沒吃）。',
    '- 只有我明確說「我吃了這份」或「請產生可記錄格式」時，才把已吃的餐點輸出成下面的格式，每個餐點一行：',
    REPLY_FORMAT_LINE,
  ];
  if (totals.protein_unknown_count > 0 || totals.needs_confirm_count > 0) {
    lines.splice(4, 0, '（有蛋白質未知或待確認的估值，數字僅供參考。）');
  }
  return lines.join('\n');
}
