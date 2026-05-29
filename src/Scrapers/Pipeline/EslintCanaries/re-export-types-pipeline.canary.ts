/**
 * Canary — closes Phase 1 acceptance criterion §12e Pipeline/Types
 * scope extension (PR #274, master plan
 * `pipeline-decoupling-master-2026-05-28`).
 *
 * <p>Verifies the {@code unicorn/prefer-export-from} rule fires on
 * the {@code import type {...}; export type {...}} barrel anti-pattern
 * (SonarCloud {@code typescript:S7763}). Without the §12e extension,
 * the global {@code ignoreUsedVariables: true} default treats the
 * re-export reference as "used" and the rule silently passes — which
 * is exactly the gap PR #274 surfaced (11 findings in
 * {@code PipelineContext.ts}).
 *
 * <p>The §12e extension at {@code eslint.config.mjs} L1393-1399 scopes
 * {@code ignoreUsedVariables: false} to:
 * <ul>
 *   <li>{@code src/Scrapers/Base/**} (original Phase 0 scope)</li>
 *   <li>{@code src/Scrapers/Pipeline/Types/**} (PR #274 addition)</li>
 * </ul>
 *
 * <p>Companion to {@code re-export-shorthand.canary.ts} which documents
 * the Base/** half. This file documents the Pipeline/Types half.
 *
 * <p>Applicable guidelines:
 * <ul>
 *   <li>{@code design-patterns-guidlines.md} — "Avoid duplication."</li>
 *   <li>{@code coding-principle-guidlines.md} §5 — SOLID Open/Closed.</li>
 *   <li>{@code before-commit-guidlines.md} — canary is a permanent guard.</li>
 * </ul>
 */

import type { Option } from '../Types/Option.js';

/**
 * Anchor — keeps the file non-empty when the linter skips bare
 * re-export statements.
 * @param value - Value to wrap.
 * @returns Wrapped option.
 */
function wrap(value: string): Option<string> {
  return { ok: true, value } as Option<string>;
}

// Deliberate violation — manual barrel re-export of an imported type
// instead of `export type { Option } from '../Types/Option.js';`.
// With §12e `ignoreUsedVariables: false` this fires `unicorn/prefer-export-from`.
export type { Option };
export { wrap };
