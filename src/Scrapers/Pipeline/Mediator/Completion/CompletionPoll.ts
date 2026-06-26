/**
 * Phase-agnostic completion POLL — repeatedly captures the completion
 * snapshot until the phase settles or an attempt budget is exhausted.
 *
 * <p>FORM-FIRST settle rule: a phase has settled when it advanced past the
 * start screen, an error surfaced, OR the filled form is gone. A perpetually
 * spinning login (form still present, no error, URL unchanged) never settles,
 * so the poll exhausts its budget — surfacing the stuck state a single
 * snapshot cannot.
 *
 * <p>SINGLE-SHOT by default: with `maxAttempts: 1` the poll captures once and
 * never sleeps, so a non-opted phase is byte-identical to a lone snapshot
 * (zero added wall-time). A phase opts into the multi-attempt budget via
 * config. Sleep is INJECTED so tests drive arbitrary timing deterministically.
 */

import { captureCompletionSignals } from './CompletionSnapshot.js';
import type { ICompletionPorts, ICompletionSignals } from './CompletionTypes.js';

/** Injected poll budget + sleep — supplied by the consuming phase. */
export interface ICompletionPollOptions {
  /** Milliseconds to wait between attempts (0 ⇒ never sleeps). */
  readonly intervalMs: number;
  /** Maximum capture attempts before giving up (1 ⇒ single-shot). */
  readonly maxAttempts: number;
  /** Injected delay between attempts (real timer in prod, fake in tests). */
  readonly sleep: (ms: number) => Promise<void>;
  /** Optional per-attempt hook — invoked with each capture (telemetry; never gates). */
  readonly onAttempt?: (attempt: number, signals: ICompletionSignals) => true;
}

/** The poll result — settled flag, attempt count, waited ms, last signals. */
export interface ICompletionPollOutcome {
  /** True when the phase settled within the attempt budget. */
  readonly settled: boolean;
  /** Number of capture attempts performed. */
  readonly attempts: number;
  /** Total milliseconds slept between attempts. */
  readonly waitedMs: number;
  /** The final captured signals. */
  readonly last: ICompletionSignals;
}

/** Ports + options bundled so the recursive tick stays a 2-param signature. */
interface IPollDeps {
  readonly ports: ICompletionPorts;
  readonly opts: ICompletionPollOptions;
}

/** Immutable poll cursor threaded through the recursion. */
interface IPollState {
  readonly attempt: number;
  readonly waitedMs: number;
}

/**
 * FORM-FIRST settle predicate: advanced, errored, or the form is gone.
 * @param signals - The freshly captured completion signals.
 * @returns True when the phase has settled.
 */
function isSettled(signals: ICompletionSignals): boolean {
  return signals.advanced || signals.hasError || !signals.formPresent;
}

/**
 * Build the terminal poll outcome from the cursor and the last snapshot.
 * @param settled - Whether the phase settled.
 * @param state - The final poll cursor.
 * @param last - The last captured signals.
 * @returns The assembled outcome.
 */
function buildOutcome(
  settled: boolean,
  state: IPollState,
  last: ICompletionSignals,
): ICompletionPollOutcome {
  return { settled, attempts: state.attempt, waitedMs: state.waitedMs, last };
}

/**
 * One poll tick — capture, settle-check, then recurse after a sleep when the
 * attempt budget allows. Sleeps only BETWEEN attempts (never after the last).
 * @param deps - Bound ports + poll options.
 * @param state - Current attempt cursor.
 * @returns The terminal poll outcome.
 */
async function pollTick(deps: IPollDeps, state: IPollState): Promise<ICompletionPollOutcome> {
  const last = await captureCompletionSignals(deps.ports);
  if (deps.opts.onAttempt !== undefined) deps.opts.onAttempt(state.attempt, last);
  if (isSettled(last)) return buildOutcome(true, state, last);
  if (state.attempt >= deps.opts.maxAttempts) return buildOutcome(false, state, last);
  await deps.opts.sleep(deps.opts.intervalMs);
  const next = { attempt: state.attempt + 1, waitedMs: state.waitedMs + deps.opts.intervalMs };
  return pollTick(deps, next);
}

/**
 * Poll the completion ports until the phase settles or the budget is spent.
 * @param ports - Phase-supplied completion capability ports.
 * @param opts - Injected poll budget + sleep.
 * @returns The poll outcome (settled flag, attempts, waited ms, last signals).
 */
async function pollCompletion(
  ports: ICompletionPorts,
  opts: ICompletionPollOptions,
): Promise<ICompletionPollOutcome> {
  return pollTick({ ports, opts }, { attempt: 1, waitedMs: 0 });
}

export default pollCompletion;
export { pollCompletion };
