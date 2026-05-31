/**
 * ESLint canary — `ReadonlySet<string>` anti-pattern.
 *
 * Mirrors the type-narrowing selector introduced after CodeRabbit
 * flagged NO_RETRY_PHASES on PR #257. Pipeline-scope sets whose
 * entries are literals from a known string union (e.g. PhaseName)
 * must be typed as `ReadonlySet<PhaseName>` with `as const` so
 * typos fail at compile time. This file deliberately violates the
 * rule so verify.sh can confirm the guardrail fires.
 */

const PHASES: ReadonlySet<string> = new Set(['home', 'login', 'dashboard']);

export { PHASES };
