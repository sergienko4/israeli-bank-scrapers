/** API strategy kind — DIRECT (SPA traffic). After .ashx removal there
 *  is one strategy; the enum is retained as a single-value frozen
 *  constant so existing callers (`apiStrategy: API_STRATEGY.DIRECT`)
 *  keep compiling without surprises. */
const API_STRATEGY = {
  DIRECT: 'DIRECT',
} as const;

/** Union type for API strategy. */
type ApiStrategyKind = (typeof API_STRATEGY)[keyof typeof API_STRATEGY];

export { API_STRATEGY };
export type { ApiStrategyKind };
