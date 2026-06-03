/**
 * Canonical bank enumeration for cross-bank parameterised tests.
 *
 * Pre-Phase 7 tests imported {@link CompanyTypes} ad-hoc and built local tuple
 * arrays (see legacy `BANK_BUILDERS` in
 * `Tests/Unit/Pipeline/Banks/AllBankPipelines.test.ts` and `BANK_SCENARIOS` in
 * `Tests/Unit/Pipeline/CrossValidation/Phases/Fixtures/_BankScenarios.ts`).
 * Phase 7 consolidates them into this single export per the cross-bank
 * STRUCTURAL principle documented in `docs/phase-7-consolidation-map.md`.
 *
 * Tests that exercise per-bank pipelines should iterate this list with
 * `it.each(BANKS)` so adding a new bank to {@link CompanyTypes} automatically
 * covers it in every flow test without per-test edits.
 *
 * This file is intentionally SLIM — the broader per-bank context factory and
 * per-flow runners land in T7.4 alongside the phase reshape work, when their
 * exact contracts can be designed against the specific phases they exercise.
 */

import { CompanyTypes } from '../../Definitions.js';

const ENUM_VALUES = Object.values(CompanyTypes);

/**
 * Canonical list of every bank the scraper supports.
 *
 * Derived from {@link CompanyTypes} enum values — adding a new bank
 * (one line in `src/Definitions.ts`) automatically appears in this list, and
 * every `it.each(BANKS)` test exercises it.
 *
 * Note: `ENUM_VALUES` is kept as a named intermediate even though it is used
 * only once, because the repo's `no-restricted-syntax FORBIDDEN NESTED CALL`
 * rule (`eslint.config.mjs`) requires nested function results to be assigned
 * to a descriptive variable for debugging clarity. Inlining
 * `Object.freeze(Object.values(...))` into a single expression triggers
 * that lint error.
 *
 * @example
 * ```ts
 * import { BANKS } from '../../Helpers/banks.js';
 * it.each(BANKS)('login flow succeeds for [%s]', (bank) => { ... });
 * ```
 */
export const BANKS: readonly CompanyTypes[] = Object.freeze(ENUM_VALUES);

/**
 * Type alias for a bank identifier — same runtime type as {@link CompanyTypes}
 * but signals "this argument is the bank under test" in cross-bank helper
 * signatures.
 */
export type BankId = CompanyTypes;
