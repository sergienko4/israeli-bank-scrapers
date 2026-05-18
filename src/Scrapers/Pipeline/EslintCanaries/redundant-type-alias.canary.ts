/**
 * Architectural canary — `sonarjs/redundant-type-aliases` must fire on
 * any `type X = <primitive-or-unknown>;` pattern across the Pipeline
 * tree.
 *
 * Why this canary exists (2026-05-18): C.4 cycle 1 (PR #235) closed
 * only 1 of 8 SonarCloud S6564 issues. The 7 remaining were
 * `type JsonValue/UntypedValue/ApiValue = unknown;` workarounds added
 * to dodge the architecture `no-restricted-syntax` rule (banning bare
 * `unknown` in function signatures). The workarounds resolved to
 * `unknown` semantically, so Sonar correctly flagged them as
 * redundant. C.5 (this commit) replaced all six with a shared
 * recursive `JsonValue` union and deleted the corresponding
 * `eslint.config.mjs` block-12 exceptions. This canary nails down the
 * outcome: if `sonarjs/redundant-type-aliases` is ever weakened or
 * disabled at the global scope, the canary stops firing and
 * `verify.sh` fails the build.
 *
 * Every `type` declaration below must be flagged by ESLint when
 * `verify.sh` runs (forces `--no-ignore`). The canary file is in
 * the global `ignores` list, so it does NOT contribute lint errors
 * to regular runs.
 */

/** Single-`unknown` alias — the historical workaround pattern. */
export type CanaryUnknownAlias = unknown;

/** Single-`string` alias — the documentation-only nominal pattern. */
export type CanaryStringAlias = string;

/** Single-`number` alias — same class as the above. */
export type CanaryNumberAlias = number;

/** Single-`boolean` alias — same class as the above. */
export type CanaryBooleanAlias = boolean;
