import type { ActivePerspective, CombatLogCategory, TacticalContact, Domain, RuntimeUnit } from '../types/wargame';

export const perspectiveLabels: Record<ActivePerspective, string> = {
  RED: '红方', BLUE: '蓝方', GOD: '全局', NEUTRAL: '中立',
};
export const domainLabels: Record<Domain, string> = {
  air: '空中', surface: '水面', subsurface: '水下', land: '陆地',
};
export const statusLabels: Record<RuntimeUnit['status'], string> = {
  operational: '正常', engaged: '交战中', evading: '规避中', returning: '返航中', recovered: '已回收', destroyed: '已摧毁',
};
export const classificationLabels: Record<TacticalContact['classification'], string> = {
  unknown: '未知', classified: '已分类', identified: '已识别',
};
export const threatLabels: Record<TacticalContact['threatLevel'], string> = {
  low: '低', medium: '中', high: '高', critical: '严重',
};
export const logCategoryLabels: Partial<Record<CombatLogCategory, string>> = {
  DETECTION: '发现', LAUNCH: '发射', INTERCEPT: '拦截', HIT: '命中',
  DESTROYED: '战损', DOCTRINE: '条令', SYSTEM: '系统',
};
