// GPT → App：只解析以 @扣打 開頭的行，產生「待確認」項目。
// 這裡只做解析，不寫入帳本；是否記入由使用者在確認卡上決定。
// 格式：@扣打 餐點完整名稱｜熱量 600-740 kcal｜蛋白質 23 g｜備註

export const PLACEHOLDER_NAMES = ['餐點完整名稱', '名稱', '食物名稱'];
export const MAX_KCAL = 4000;
export const MAX_PROTEIN = 300;

const LEADING_JUNK = /^[\s>*\-•·`"'「『“＞＊－｀]+/;
const NUMBERED = /^\d+[.)、]\s*/;
const PREFIX = /^[@＠]\s*扣打\s*[:：]?\s*/;

export function normalizeLine(s) {
  return String(s).normalize('NFKC').replace(/[–—−〜~]/g, '-').replace(/\s+/g, '').toLowerCase();
}

// 全形轉半形、各種破折號與波浪號統一成 "-"、數字千分位拿掉
function canon(s) {
  return String(s)
    .normalize('NFKC')
    .replace(/[–—−〜~]/g, '-')
    .replace(/(\d),(?=\d{3}\b)/g, '$1');
}

function stripLeading(line) {
  let s = line;
  for (let i = 0; i < 6; i += 1) {
    const before = s;
    s = s.replace(LEADING_JUNK, '').replace(NUMBERED, '');
    if (s === before) break;
  }
  return s;
}

const UNKNOWN = /^(未知|不明|不詳|未估|待估|無資料|\?|n\/a|null|-)?$/i;

// 解析「600-740 kcal」「650」「約 23 g」「未知」。回傳 { unknown } 或 { low, high } 或 { error }
function parseValue(expr, { max, what }) {
  const t = expr.trim();
  if (UNKNOWN.test(t.replace(/[（(].*$/, '').trim())) return { unknown: true };
  if (/^(約|大約|約莫|about)?\s*-\s*\d/i.test(t)) return { error: `${what}不可為負數` };
  const outside = t.replace(/\([^)]*\)/g, ' ');
  if (/\(/.test(t) && /\d/.test(t.match(/\([^)]*\)/g)?.join('') ?? '')) {
    return { error: `${what}的括號內有數字，無法判斷；請寫成「低-高」範圍或單一數字` };
  }
  const nums = [...outside.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (nums.length === 0) return { error: `${what}沒有數字` };
  if (nums.length > 2) return { error: `${what}出現 ${nums.length} 個數字，無法判斷哪個是${what}` };
  let [low, high] = nums.length === 1 ? [nums[0], nums[0]] : nums;
  let swapped = false;
  if (low > high) { [low, high] = [high, low]; swapped = true; }
  if (high > max) return { error: `${what}異常（超過 ${max}），請改用手動輸入確認` };
  return { low, high, swapped };
}

// stripped：已去掉行首符號的「原始」文字（名稱要保留使用者／GPT 寫的原樣，不做全形轉半形）
function parseLine(stripped, raw, lineNo) {
  const result = { lineNo, raw: raw.trim(), ok: false, warnings: [] };
  const body = stripped.replace(PREFIX, '');
  const parts = body.split(/[|｜]/).map((p) => p.trim());
  const name = (parts.shift() ?? '').replace(/^[:：\s]+/, '').trim();
  const canonParts = parts.map((p) => canon(p).trim());
  if (!name) return { ...result, reason: '缺少餐點名稱' };
  if (PLACEHOLDER_NAMES.includes(name)) return { ...result, reason: '這是格式範例，不是實際餐點' };

  let kcal = null;
  let protein = null;
  let proteinSeen = false;
  const notes = [];
  for (const [i, cpart] of canonParts.entries()) {
    const part = cpart;
    if (!part) continue;
    if (/^(熱量|卡路里|kcal)/i.test(part) && !kcal) {
      kcal = parseValue(part.replace(/^(熱量|卡路里|kcal)\s*[:：]?/i, ''), { max: MAX_KCAL, what: '熱量' });
    } else if (/^(蛋白質|蛋白|protein)/i.test(part) && !proteinSeen) {
      proteinSeen = true;
      protein = parseValue(part.replace(/^(蛋白質|蛋白|protein)\s*[:：]?/i, ''), { max: MAX_PROTEIN, what: '蛋白質' });
    } else if (/^(備註|註|note)\s*[:：]?/i.test(part)) {
      notes.push(parts[i].replace(/^(備註|註|note)\s*[:：]?/i, '').trim());
    } else if (!kcal && /(kcal|大卡|卡)/i.test(part) && /\d/.test(part)) {
      kcal = parseValue(part, { max: MAX_KCAL, what: '熱量' });
    } else if (!proteinSeen && /\d\s*(g\b|公克|克)/i.test(part)) {
      proteinSeen = true;
      protein = parseValue(part, { max: MAX_PROTEIN, what: '蛋白質' });
    } else {
      notes.push(parts[i]);
    }
  }

  if (!kcal) return { ...result, name, reason: '缺少熱量' };
  if (kcal.error) return { ...result, name, reason: kcal.error };
  if (kcal.unknown) return { ...result, name, reason: '熱量未知，無法記入（可改用「＋粗估」自己填）' };
  if (protein?.error) return { ...result, name, reason: protein.error };
  if (kcal.swapped) result.warnings.push('熱量範圍上下限顛倒，已自動對調');
  if (protein?.swapped) result.warnings.push('蛋白質範圍上下限顛倒，已自動對調');

  const hasRange = kcal.low !== kcal.high;
  const out = {
    ...result,
    ok: true,
    name,
    kcalLow: kcal.low,
    kcalHigh: kcal.high,
    kcalMid: hasRange ? Math.round((kcal.low + kcal.high) / 2) : kcal.low,
    hasRange,
    // 蛋白質有範圍時採下限（與「熱量取高、蛋白質取低」的保守原則一致）；未知＝null，不是 0
    protein: protein && !protein.unknown ? protein.low : null,
    proteinHigh: protein && !protein.unknown ? protein.high : null,
    note: notes.filter(Boolean).join('｜') || null,
  };
  if (out.proteinHigh !== null && out.proteinHigh !== out.protein) {
    out.warnings.push(`蛋白質 ${out.protein}–${out.proteinHigh} g，記入時採下限 ${out.protein} g`);
  }
  return out;
}

// 回傳 { items（可記入）, rejected（含原因）, mentions（含 @扣打 但不在行首） }
export function parseGptText(text) {
  const items = [];
  const rejected = [];
  const mentions = [];
  const seen = new Set();
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const normalized = canon(raw);
    const stripped = stripLeading(raw).replace(/[`"'」』”]+\s*$/, '');
    if (PREFIX.test(stripped)) {
      const r = parseLine(stripped, raw, lineNo);
      const key = normalizeLine(r.raw);
      r.key = key;
      if (!r.ok) rejected.push(r);
      else if (seen.has(key)) rejected.push({ ...r, ok: false, reason: '這一次貼上的內容裡已有相同的一行' });
      else {
        seen.add(key);
        items.push(r);
      }
    } else if (/@\s*扣打/.test(normalized)) {
      mentions.push({ lineNo, raw: raw.trim() });
    }
  });
  return { items, rejected, mentions };
}

// 標出「今天已經用同一行記過」的項目（預設不勾選）
export function markDuplicates(items, entries, dietDay) {
  const used = new Set(entries.filter((e) => e.diet_day === dietDay && e.gpt_raw_line).map((e) => normalizeLine(e.gpt_raw_line)));
  return items.map((it) => ({ ...it, duplicate: used.has(it.key) }));
}
