/**
 * Pure constructors for the final probe result envelope. Build the
 * trailing timing fields and assemble the discriminated outcome +
 * collected envelope fields into the {@link INavTransportProbe} written
 * to the navigation-failure snapshot. No I/O.
 */

import type {
  INavTransportProbe,
  IProbeContext,
  IProbeEnvelope,
  IProbeRunInput,
  TransportProbeOutcome,
} from './Types.js';

/** Bundle of inputs to {@link buildProbeResult} (`max-params: 3`). */
export interface IBuildProbeInput {
  readonly context: IProbeContext;
  readonly outcome: TransportProbeOutcome;
  readonly envelope: IProbeEnvelope;
}

/** Trailing timing / budget fields shared by every probe envelope. */
interface IProbeTimingFields {
  readonly timing: 'post-failure';
  readonly startedMsAfterGotoFailure: number;
  readonly totalBudgetMs: number;
}

/**
 * Build the trailing timing / budget fields shared by every probe
 * envelope. Pulled out so {@link buildProbeResult} fits ≤ 10 LoC.
 *
 * @param run - Probe run inputs (carries timing baseline + total budget).
 * @returns Object literal with `timing`, `startedMsAfterGotoFailure`, `totalBudgetMs`.
 */
function buildTimingFields(run: IProbeRunInput): IProbeTimingFields {
  return {
    timing: 'post-failure',
    startedMsAfterGotoFailure: run.startedMsAfterGotoFailure,
    totalBudgetMs: run.totalBudgetMs,
  };
}

/**
 * Build the final probe result envelope from the discriminated
 * outcome + collected envelope fields. Pure constructor; no I/O.
 *
 * @param input - Context + outcome + envelope (all timing + IP fields).
 * @returns The probe envelope written to the snapshot.
 */
export function buildProbeResult(input: IBuildProbeInput): INavTransportProbe {
  const { url, run } = input.context;
  return {
    host: url.host,
    port: url.port,
    outcome: input.outcome,
    ...input.envelope,
    ...buildTimingFields(run),
  };
}
