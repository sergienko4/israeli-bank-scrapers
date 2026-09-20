/**
 * Cold-login budget for a single scrape run.
 *
 * <p>A cold flow replays a bank's login from the beginning, so it always walks
 * the step that sends the SMS — whichever step that is. (It is not always the
 * first: PayBox sends at step 0, but OneZero and Pepper send at step 1, after
 * a device-binding call.) What matters is that a warm resume starts *past*
 * that step and a cold flow does not, so "how many flows started cold" is the
 * count of messages the run can have caused.
 *
 * <p>Nothing counted them before. `guardedRefreshOp` reads like the cap but is
 * a re-entrancy latch — it blocks a refresh nested inside a refresh and
 * releases in `finally` — while `retryOn401Op` sits on the mainline of every
 * `apiPost`, `apiGet` and `apiQuery`. A session the bank has decided to refuse
 * therefore bought one fresh login, and one fresh SMS, per rejected request.
 *
 * <p>The charge is taken when a cold flow *starts*, not when the message
 * provably leaves. That deliberately over-counts a flow that dies before
 * reaching the send step: the alternative under-counts a flow that sends the
 * message and then dies, and only over-counting keeps "at most one SMS" true.
 * Availability is the price, and it is the right way round to be wrong.
 *
 * <p>The counter lives on the strategy's capture slot because that slot is
 * already exactly run-scoped: `assembleStrategy` creates one per strategy and
 * the strategy is built once per scrape. A new scrape gets a new slot and a
 * full budget, which is what makes "one SMS per run" the guarantee rather than
 * "one SMS ever".
 */

import type { ILongTermTokenSlot, IRunFlowArgs } from './TokenStrategyFromConfig.types.js';

/**
 * Cold logins one scrape run may spend.
 *
 * <p>One, because a second has never been able to help: the bank refused the
 * credentials the first flow just minted, and replaying the same flow asks the
 * same question. For OneZero it is actively harmful — minting revokes the
 * previous long-term token (issue #580) — so the retry destroys the very token
 * the run was trying to keep.
 */
const COLD_FLOW_BUDGET = 1;

/**
 * Whether these args replay the login from the beginning, walking the step
 * that sends the SMS.
 *
 * <p>Warm resumes carry `startStepIndex` from `makeWarmArgs`; both cold call
 * sites pass none and the runner defaults it to 0. That a warm resume really
 * does start past the send step is not left to chance: `WarmStartContract`
 * asserts every `sms-otp` config resumes strictly after its last OTP pre-hook,
 * so a config that resumed early would fail there rather than silently send an
 * uncharged message here.
 * @param args - Run args for the flow about to start.
 * @returns True when starting this flow would cost a message.
 */
function isColdStart(args: IRunFlowArgs): boolean {
  const startIndex = args.startStepIndex ?? 0;
  return startIndex === 0;
}

/**
 * Draw one cold login from the run's budget, if any is left.
 *
 * <p>Warm resumes are never charged: refusing one would break the legitimate
 * warm→cold escalation before the bank had been asked anything.
 * @param args - Run args for the flow about to start.
 * @param slot - Run-scoped capture slot carrying the counter.
 * @returns True when the flow may run; false when the run is out of budget.
 */
function mayStartFlow(args: IRunFlowArgs, slot: ILongTermTokenSlot): boolean {
  if (!isColdStart(args)) return true;
  const spent = slot.coldFlowsStarted ?? 0;
  if (spent >= COLD_FLOW_BUDGET) return false;
  slot.coldFlowsStarted = spent + 1;
  return true;
}

export { COLD_FLOW_BUDGET, mayStartFlow };
