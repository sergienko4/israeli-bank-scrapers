/**
 * One shared result-guard policy for every api-direct bank. The universal
 * zero-account floor is composed ahead of this policy; a bank declares only
 * its extra checks as data.
 */

import type { WindowCaveat } from '../../../../WindowCoverage.js';
import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import type { IApiDirectScrapeGuardSummary } from './IApiDirectScrapeShape.js';

/** A bank's extra result checks, expressed as data. */
interface IResultGuardPolicy {
  /** Refuse a degraded balance or unavailable caveats. */
  readonly requireCompleteEvidence?: boolean;
  /** Message for incomplete evidence. */
  readonly incompleteMessage?: string;
  /** Caveats that prove rows were lost; any one refuses the scrape. */
  readonly lossCaveats?: readonly WindowCaveat[];
  /** Message for observed row loss. */
  readonly lossMessage?: string;
  /** Refuse the degraded-empty signature. */
  readonly failOnDegradedEmpty?: boolean;
  /** Message for the degraded-empty signature. */
  readonly degradedEmptyMessage?: string;
}

/** A scrape result guard — mirrors `IApiDirectScrapeShape.resultGuard`. */
type ScrapeResultGuard = (summary: IApiDirectScrapeGuardSummary) => Procedure<void>;

/** Fallback messages, used only when a policy omits its own text. */
const INCOMPLETE_DEFAULT = 'scrape financial evidence is incomplete';
const LOSS_DEFAULT = 'scrape observed transaction loss';
const DEGRADED_EMPTY_DEFAULT = 'scrape returned no transactions while the balance fell back';

/**
 * Whether complete evidence is missing.
 * @param summary - PII-free scrape summary.
 * @returns True when the balance fell back or caveats are unavailable.
 */
function isIncomplete(summary: IApiDirectScrapeGuardSummary): boolean {
  return summary.balanceDegraded || summary.observedCaveats === undefined;
}

/**
 * Whether the summary has the degraded-empty signature.
 * @param summary - PII-free scrape summary.
 * @returns True for accounts, zero transactions and a degraded balance.
 */
function isDegradedEmpty(summary: IApiDirectScrapeGuardSummary): boolean {
  return summary.accountCount >= 1 && summary.totalTxns === 0 && summary.balanceDegraded;
}

/**
 * Whether any observed caveat proves row loss.
 * @param summary - PII-free scrape summary.
 * @param lossCaveats - Caveats that prove loss.
 * @returns True when one is observed.
 */
function hasLoss(
  summary: IApiDirectScrapeGuardSummary,
  lossCaveats: readonly WindowCaveat[],
): boolean {
  const observed = summary.observedCaveats;
  if (observed === undefined) return false;
  return lossCaveats.some(caveat => observed.includes(caveat));
}

/**
 * Refuse incomplete evidence when the policy requires it.
 * @param summary - PII-free scrape summary.
 * @param policy - Bank policy.
 * @returns A failure, or false when the check passes.
 */
function incompleteFailure(
  summary: IApiDirectScrapeGuardSummary,
  policy: IResultGuardPolicy,
): Procedure<void> | false {
  if (policy.requireCompleteEvidence !== true || !isIncomplete(summary)) return false;
  return fail(ScraperErrorTypes.Generic, policy.incompleteMessage ?? INCOMPLETE_DEFAULT);
}

/**
 * Refuse an observed loss caveat.
 * @param summary - PII-free scrape summary.
 * @param policy - Bank policy.
 * @returns A failure, or false when the check passes.
 */
function lossFailure(
  summary: IApiDirectScrapeGuardSummary,
  policy: IResultGuardPolicy,
): Procedure<void> | false {
  const { lossCaveats } = policy;
  if (lossCaveats === undefined || !hasLoss(summary, lossCaveats)) return false;
  return fail(ScraperErrorTypes.Generic, policy.lossMessage ?? LOSS_DEFAULT);
}

/**
 * Refuse the degraded-empty signature when the policy names it.
 * @param summary - PII-free scrape summary.
 * @param policy - Bank policy.
 * @returns A failure, or false when the check passes.
 */
function degradedEmptyFailure(
  summary: IApiDirectScrapeGuardSummary,
  policy: IResultGuardPolicy,
): Procedure<void> | false {
  if (policy.failOnDegradedEmpty !== true || !isDegradedEmpty(summary)) return false;
  return fail(ScraperErrorTypes.Generic, policy.degradedEmptyMessage ?? DEGRADED_EMPTY_DEFAULT);
}

/**
 * Run one policy check.
 * @param check - The check to run.
 * @param summary - PII-free scrape summary.
 * @param policy - Bank policy.
 * @returns The failure, or false when the check passes.
 */
function runCheck(
  check: typeof incompleteFailure,
  summary: IApiDirectScrapeGuardSummary,
  policy: IResultGuardPolicy,
): Procedure<void> | false {
  return check(summary, policy);
}

/**
 * Run the policy's checks in a fixed order.
 * @param summary - PII-free scrape summary.
 * @param policy - Bank policy.
 * @returns The first failure, or a pass-through success.
 */
function evaluate(
  summary: IApiDirectScrapeGuardSummary,
  policy: IResultGuardPolicy,
): Procedure<void> {
  const checks = [incompleteFailure, lossFailure, degradedEmptyFailure];
  const results = checks.map(check => runCheck(check, summary, policy));
  const failure = results.find((result): result is Procedure<void> => result !== false);
  return failure ?? succeed(undefined);
}

/**
 * Build the extra-check predicate from a bank's data policy.
 * @param policy - Extra checks the bank declares.
 * @returns A fail-closed result guard.
 */
function resultGuardFromPolicy(policy: IResultGuardPolicy): ScrapeResultGuard {
  return (summary): Procedure<void> => evaluate(summary, policy);
}

export default resultGuardFromPolicy;
