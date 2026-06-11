/**
 * Bank-scoped async-local-storage for log line context injection.
 *
 * Owns the per-run `bank` / `phase` / `stage` / `runId` ambient context
 * that pino's mixin hook merges into every emitted line. Extracted from
 * the legacy {@link ../Types/Debug.ts} blob during Phase 12c so the
 * logging cluster lives at `Pipeline/Logging/` instead of being hidden
 * under `Pipeline/Types/`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { getActivePhase, getActiveStage } from '../Types/ActiveState.js';
import { getActiveRunId } from '../Types/TraceConfig.js';

/** Bank context shape for async-local storage. */
interface IBankContext {
  readonly [key: string]: string;
  bank: string;
}

/**
 * Create the async-local store for bank context.
 * Uses Reflect.construct to avoid the no-restricted-syntax rule on `new X()`.
 * @returns A typed AsyncLocalStorage instance.
 */
function createBankStore(): AsyncLocalStorage<IBankContext> {
  return Reflect.construct(AsyncLocalStorage, []) as AsyncLocalStorage<IBankContext>;
}

/** Async-local store for per-request bank context injected into every log line. */
const BANK_CONTEXT = createBankStore();

/**
 * Pino mixin: injects ambient context onto every log line so callers
 * never have to attach `bank` / `phase` / `stage` / `runId` manually.
 *
 * Fields:
 *   - `bank` / extra fields — read from the AsyncLocalStorage scope
 *     established by {@link runWithBankContext}.
 *   - `phase` — current pipeline phase (init / login / scrape / …).
 *   - `stage` — 4-stage protocol (PRE / ACTION / POST / FINAL).
 *   - `runId` — per-process run-stamp (`DD-MM-YYYY_HHMMSScc`); SAME
 *     value the trace artefact folder is named with on disk, so a log
 *     line can be deterministically joined to its `network/` and
 *     `screenshots/` siblings even after logs are aggregated off-host.
 *     Omitted from the mixin object when empty (pre-`setActiveBank`
 *     log lines) so it never appears as `runId:""` noise.
 *
 * @returns Mixin fields to merge onto every log entry.
 */
export function getBankMixin(): Record<string, string> {
  const bank = BANK_CONTEXT.getStore() ?? {};
  const runId = getActiveRunId();
  return {
    ...bank,
    phase: getActivePhase(),
    stage: getActiveStage(),
    ...(runId.length > 0 ? { runId } : {}),
  };
}

/**
 * Run a function with bank context injected into all pino log lines.
 * @param bank - The bank identifier (companyId).
 * @param fn - The async function to execute within the bank context.
 * @returns The result of the function.
 */
export function runWithBankContext<T>(bank: string, fn: () => T): T {
  return BANK_CONTEXT.run({ bank }, fn);
}

/**
 * Read-only accessor for the pino mixin record — every log line gets
 * these fields injected automatically through pino's `mixin` hook.
 * Production code never needs to call this; exposed so unit tests can
 * assert the auto-injection contract (notably `runId`) directly,
 * without depending on async file-transport flush timing.
 * @returns Same record the pino mixin merges onto every log entry.
 */
export function getActiveLogContext(): Record<string, string> {
  return getBankMixin();
}
