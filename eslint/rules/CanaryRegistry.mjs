// @ts-check
/**
 * File-specific rules armed on individual canary fixtures, and the
 * derived maps the canary harness and syntax gate consume.
 */
import {
  BALANCE_DEFAULT_DENY_RULES,
  LOWER_KEYS_ARRAY_RULE,
  PII_ERRORLOG_NO_BYPASS_RULE,
  PII_SENTINEL_LITERAL_RULES,
} from './GuardRules.mjs';
import { PIPELINE_CANARY_SYNTAX_RULES, selectorOf } from './PipelineContract.mjs';

/**
 * File-specific rule entries a single canary exists to certify.
 *
 * These used to live inline in the production block that owns the rule, with
 * the canary path bolted onto that block's `files`. That spelling is unsafe
 * for the reason this whole section exists: any later block touching the
 * canary directory replaces the options wholesale, and the canary keeps
 * failing — just on some unrelated rule — so nothing reports the loss.
 *
 * Declared here and emitted last (§22a), a canary's extra entry cannot be
 * outranked, and `check-syntax-guardrails.mjs` proves each one resolves.
 */
const CANARY_EXTRA_RULES = {
  // §8i: `balance ?? 0` / `?? null` collapses unknown into a real value.
  'src/Scrapers/Pipeline/EslintCanaries/balance-default-zero.canary.ts': BALANCE_DEFAULT_DENY_RULES,
  // §12C: `lower*Keys` implies membership testing — use a Set.
  'src/Scrapers/Pipeline/EslintCanaries/scrape-canonical10-lookup-array-shouldbe-set.canary.ts': [
    LOWER_KEYS_ARRAY_RULE,
  ],
  // §13: redaction sentinels are defined once in `PiiRedactor/Types.ts`.
  'src/Scrapers/Pipeline/EslintCanaries/pii-hardcoded-sentinel.canary.ts':
    PII_SENTINEL_LITERAL_RULES,
  // §13C: `ErrorLog.ts` must always-redact; the canary proves the ban fires.
  'src/Scrapers/Pipeline/EslintCanaries/pii-errorlog-bypass.canary.ts': [
    PII_ERRORLOG_NO_BYPASS_RULE,
  ],
};

/** `canary path → selector[]`, for the gate. Derived so the two cannot drift. */
export const CANARY_EXTRA_SELECTORS = Object.fromEntries(
  Object.entries(CANARY_EXTRA_RULES).map(([file, rules]) => [file, rules.map(selectorOf)]),
);

/**
 * `canary path → message[]` for the rules a canary was written to certify.
 *
 * A canary given a file-specific rule exists for that rule and nothing else, so
 * this map is ground truth for its subject. The harness asserts the canary
 * declares one of these messages: a fixture usually trips bystander selectors
 * too, and declaring a bystander certifies the wrong guardrail while still
 * reporting green.
 */
export const CANARY_EXTRA_MESSAGES = Object.fromEntries(
  Object.entries(CANARY_EXTRA_RULES).map(([file, rules]) => [
    file,
    rules.map(entry => (typeof entry === 'string' ? '' : entry.message)).filter(Boolean),
  ]),
);

/** Config blocks arming each canary's file-specific rule. Emitted last. */
const CANARY_EXTRA_BLOCKS = Object.entries(CANARY_EXTRA_RULES).map(([file, rules]) => ({
  files: [file],
  rules: {
    'no-restricted-syntax': ['error', ...PIPELINE_CANARY_SYNTAX_RULES, ...rules],
  },
}));

export {
  CANARY_EXTRA_BLOCKS,
  CANARY_EXTRA_RULES,
};
