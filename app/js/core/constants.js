export const SCHEMA_VERSION = 1;
export const BACKUP_FORMAT = 'kouda-backup';
export const BACKUP_SCOPES = ['library', 'full'];

export const SOURCE_TYPES = ['label', 'recipe_calc', 'legacy_estimate', 'gpt_estimate', 'rough'];
export const SOURCE_LABELS = {
  label: '包裝標示',
  recipe_calc: '固定配方',
  legacy_estimate: '舊估算',
  gpt_estimate: 'GPT估算',
  rough: '粗估',
};

export const FOOD_KINDS = ['single', 'opaque'];

export const LEVELS = ['low', 'normal', 'high'];
export const LEVEL_LABELS = { low: '偏少', normal: '一般', high: '偏多' };

export const ORIGINS = ['food', 'preset', 'rough', 'gpt'];
export const QUICK_SLOT_TYPES = ['food', 'preset'];
export const MAX_QUICK_SLOTS = 12;

export const MAX_BOUNDARY_HOUR = 12;
