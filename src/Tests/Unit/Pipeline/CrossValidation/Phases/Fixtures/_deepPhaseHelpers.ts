/**
 * Phase H+ deep-factory shared helpers.
 *
 * <p>Four utilities used by every per-phase deep factory + the
 * full-flow factory:
 *
 * <ul>
 *   <li>{@link PLACEHOLDER_LOGIN_CONFIG} — a properly-typed +
 *     deep-frozen {@link ILoginConfig} value used when a non-LOGIN
 *     phase reuses {@link buildDeepLoginContext} for its mediator+
 *     executor wiring (HOME, PRE-LOGIN, AUTH-DISCOVERY, OTP-TRIGGER,
 *     OTP-FILL). Replaces the 5 duplicated
 *     `{ fields: [], submit: [], loginUrl: '' } as unknown as ...`
 *     casts the rabbit flagged in cycle #3 findings #1, #7 +
 *     `eslint.config.mjs §8a` double-cast ban. Frozen so accidental
 *     `.fields.push(...)` etc. throws at runtime instead of
 *     polluting other tests (CodeRabbit self-review M1).</li>
 *
 *   <li>{@link unwrapOrThrow} — extracts `.value` from a
 *     {@link Procedure} or throws a {@link ScraperError} with a
 *     bank-scoped failure prefix + error type. Replaces the 6-line
 *     success/error unwrap pattern duplicated across every
 *     `run<Phase><Step>` helper, letting each helper stay ≤10 lines
 *     per the project's max-method-length rule (rabbit cycle #3
 *     findings #2, #8 + `eslint.config.mjs §8a`
 *     max-lines-per-function).</li>
 *
 *   <li>{@link mergeActionDiagnostics} — overlays an
 *     {@link IActionContext}'s diagnostics onto the PRE-updated
 *     pipeline context so POST reads the same state production
 *     sees. Production sealing strips `mediator`/`browser`/`login`
 *     from the action context; this helper rehydrates them from
 *     preCtx while preserving ACTION's diagnostic stamps. Replaces
 *     the per-factory inline merge + makes the threading visible
 *     to the `PostUsesActionContext` canary (CodeRabbit
 *     self-review M2).</li>
 *
 *   <li>{@link REDACTED_DATE} — constant ISO timestamp used as the
 *     redacted txn date across {@link Scrape} +
 *     {@link FullFlow} factories. Centralised here so a future
 *     redaction-policy change touches one place (CodeRabbit
 *     self-review M3).</li>
 * </ul>
 *
 * <p>This file is the single source of truth for these patterns —
 * any further drift will be caught by `sonarjs/no-identical-functions`
 * + `sonarjs/no-duplicate-string` once these helpers are adopted
 * everywhere.
 */

import type { ILoginConfig } from '../../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  type ITransaction,
  TransactionStatuses,
  TransactionTypes,
} from '../../../../../../Transactions.js';

/** Constant ISO timestamp for the redacted txn date (PII-redacted). */
export const REDACTED_DATE = '2026-05-01T00:00:00.000Z';

/**
 * Frozen template for every redacted txn shared by the SCRAPE +
 * FullFlow factories. Only the {@link ITransaction.identifier} field
 * varies per call site; everything else is PII-redacted constants.
 * Centralised here so any future redaction-policy change touches one
 * place (CodeRabbit self-review M3) AND each
 * `buildRedactedTxn<Prefix>` helper stays ≤10 lines after prettier
 * reformatting.
 */
const REDACTED_TXN_BASE: Omit<ITransaction, 'identifier'> = Object.freeze({
  type: TransactionTypes.Normal,
  date: REDACTED_DATE,
  processedDate: REDACTED_DATE,
  originalAmount: -100,
  originalCurrency: 'ILS',
  chargedAmount: -100,
  description: 'FAKE TEXT',
  status: TransactionStatuses.Completed,
});

/**
 * Build a redacted {@link ITransaction} with the supplied identifier
 * prefix + ordinal (e.g. `FAKE-TXN-0`, `FAKE-FLOW-3`).
 *
 * @param identifierPrefix - Bank-agnostic identifier prefix (no PII).
 * @param ordinal - Identifier suffix for uniqueness.
 * @returns Redacted transaction record built from REDACTED_TXN_BASE.
 */
export function buildRedactedTxn(identifierPrefix: string, ordinal: number): ITransaction {
  return { ...REDACTED_TXN_BASE, identifier: `${identifierPrefix}-${String(ordinal)}` };
}

/**
 * Typed + deep-frozen placeholder {@link ILoginConfig} for non-LOGIN
 * deep factories.
 *
 * <p>The HOME / PRE-LOGIN / AUTH-DISCOVERY / OTP-TRIGGER / OTP-FILL
 * factories reuse {@link buildDeepLoginContext} only for the
 * mediator + executor wiring — they never read `loginConfig.fields`.
 * The placeholder gives the type-checker every required field
 * (`loginUrl`, `fields`, `submit`, `possibleResults`) with safe
 * empty defaults, so no cast is needed at call sites.
 *
 * <p>Object.freeze on the wrapper AND the inner arrays + nested
 * objects: any test that accidentally writes (e.g.
 * `PLACEHOLDER_LOGIN_CONFIG.fields.push(...)`) throws at runtime
 * instead of silently polluting other tests' setup.
 */
export const PLACEHOLDER_LOGIN_CONFIG: Readonly<ILoginConfig> = Object.freeze({
  loginUrl: '',
  fields: Object.freeze([] as ILoginConfig['fields']),
  submit: Object.freeze([] as ILoginConfig['submit']),
  possibleResults: Object.freeze({
    success: Object.freeze([] as ILoginConfig['possibleResults']['success']),
  }),
}) as Readonly<ILoginConfig>;

/**
 * Extract `.value` from a {@link Procedure} or throw a bank-scoped
 * {@link ScraperError}. Centralises the success/failure unwrap so
 * per-phase `run<Phase><Step>` helpers can stay ≤10 lines.
 *
 * <p>The thrown message includes both the structured `errorType` and
 * the human-readable `errorMessage` from the Procedure failure, so
 * test output preserves the error category for diagnostics
 * (CodeRabbit self-review M5).
 *
 * @template TValue - The success-payload type carried by the result.
 * @param result - Procedure result returned by a production handler.
 * @param failurePrefix - Bank-scoped prefix for the error message,
 *   e.g. `'HOME_PRE_FAILED bank=hapoalim'`. Appears verbatim before
 *   the underlying error type + message.
 * @returns The success payload (`result.value`) when `result.success`
 *   is true.
 * @throws {ScraperError} When `result.success` is false; the message
 *   format is `${failurePrefix} [${errorType}] - ${errorMessage}`.
 */
export function unwrapOrThrow<TValue>(result: Procedure<TValue>, failurePrefix: string): TValue {
  if (!result.success) {
    throw new ScraperError(`${failurePrefix} [${result.errorType}] - ${result.errorMessage}`);
  }
  return result.value;
}

/**
 * Overlay ACTION's diagnostics onto a PRE-updated pipeline context
 * so POST reads the diagnostic stamps ACTION committed. Production
 * sealing strips `mediator` / `browser` / `login` from the action
 * context; this helper rehydrates them from preCtx while preserving
 * ACTION's diagnostics. Replaces the 5 inline merge sites flagged
 * in CodeRabbit self-review M2 + makes the threading visible to
 * the `PostUsesActionContext` canary.
 *
 * @param preCtx - PRE-updated pipeline context (browser/mediator/login).
 * @param actionCtx - ACTION-updated sealed context (diagnostics).
 * @returns Merged pipeline context for POST input.
 */
export function mergeActionDiagnostics(
  preCtx: IPipelineContext,
  actionCtx: IActionContext,
): IPipelineContext {
  return { ...preCtx, diagnostics: actionCtx.diagnostics };
}
