/**
 * AccountResolveActions.Failures — fail-loud builders + diagnostic
 * helpers shared across the AccountResolveActions siblings
 * (phase-2e-residue split).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';

/** Three-way comparison sentinel returned by {@link compareLocale}. */
type CompareSign = -1 | 0 | 1;

/**
 * Locale-aware comparator wrapping `String.localeCompare`. Result is
 * narrowed via `Math.sign` so the return stays a CompareSign sentinel.
 * @param a - First string.
 * @param b - Second string.
 * @returns -1 when a < b, 0 when equal, 1 when a > b.
 */
function compareLocale(a: string, b: string): CompareSign {
  const cmp = a.localeCompare(b);
  return Math.sign(cmp) as CompareSign;
}

/**
 * Render a per-container count map as a stable diagnostic string.
 * Carries only WK constant names + integer counts — no PII.
 * @param containers - Per-WK-name container split from the picked endpoint.
 * @returns Sorted `name:count` joined with `,`, or `none`.
 */
function renderContainerCounts(
  containers: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): string {
  const names = Object.keys(containers).sort(compareLocale);
  if (names.length === 0) return 'none';
  return names.map((name): string => `${name}:${String(containers[name].length)}`).join(',');
}

/**
 * Builds the `ACCOUNT_RESOLUTION_FAILED` failure for the empty-pool branch.
 * @param poolSize - Pre-nav capture count for the diagnostic message.
 * @returns Failure procedure with the fail-loud message.
 */
function failAccountResolutionFailed(poolSize: number): Procedure<IPipelineContext> {
  const msg =
    'ACCOUNT-RESOLVE POST: ACCOUNT_RESOLUTION_FAILED — ' +
    `pool=${String(poolSize)} captures, no id-bearing`;
  return fail(ScraperErrorTypes.Generic, msg);
}

/** Bundled args for the incomplete-resolution fail builder. */
interface IIncompleteFailArgs {
  readonly resolved: number;
  readonly expected: number;
  readonly containers: Readonly<Record<string, readonly Record<string, unknown>[]>>;
}

/**
 * Builds the `ACCOUNT_RESOLUTION_INCOMPLETE` failure when the picker
 * returned fewer ids than the SUM of every WK container in the picked
 * endpoint's body.
 * @param args - Resolved/expected counts + container split for diagnostics.
 * @returns Failure procedure with the fail-loud message.
 */
function failAccountResolutionIncomplete(args: IIncompleteFailArgs): Procedure<IPipelineContext> {
  const detail = renderContainerCounts(args.containers);
  const msg =
    'ACCOUNT-RESOLVE POST: ACCOUNT_RESOLUTION_INCOMPLETE — ' +
    `resolved=${String(args.resolved)}, expected=${String(args.expected)}, ` +
    `containers={${detail}}`;
  return fail(ScraperErrorTypes.Generic, msg);
}

export type { IIncompleteFailArgs };
export { failAccountResolutionFailed, failAccountResolutionIncomplete };
