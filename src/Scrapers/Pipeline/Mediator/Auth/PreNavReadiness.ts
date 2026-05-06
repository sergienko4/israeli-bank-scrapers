/**
 * Pre-nav readiness check — the auth-side gatekeeper.
 *
 * Each FINAL of an auth phase (LOGIN.FINAL for non-OTP banks,
 * OTP-FILL.FINAL for OTP banks) verifies that the dashboard
 * initial render has produced a capture whose response body holds a
 * WK account container (`cardsList` / `cards` / `accounts` /
 * `bankAccounts`). This is the user contract: the LAST auth phase is
 * responsible for proving "auth done + page loaded + account info
 * available", so the next phase (DASHBOARD) can run pure orchestration
 * without re-checking.
 *
 * Robust against gate timing: if the network gate hasn't activated
 * collection yet (pre-nav empty), the check skips with a `success`
 * outcome — the LATER auth phase will perform the real check. This
 * lets LOGIN.FINAL run the check for non-OTP banks (gate already on)
 * while OTP banks defer to OTP-FILL.FINAL (gate flips on at OTP-FILL
 * entry, so by FINAL the captures are in).
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { extractAccountRecords } from '../Scrape/ScrapeAutoMapper.js';

/**
 * Returns true when the pre-nav bucket carries at least one capture
 * whose body holds account-shaped records. Delegates to the same
 * 3-tier extractor used by SCRAPE.PRE (`extractAccountRecords`):
 *   1. Named container (cards / cardsList / accounts / bankAccounts)
 *   2. Txn-signature BFS array
 *   3. Root-level array of account-shaped records (Hapoalim shape)
 * Reusing one extractor guarantees that whatever shape SCRAPE.PRE
 * later succeeds on, the auth-side gatekeeper accepts as well.
 * @param ctx - Pipeline context.
 * @returns True when the contract is satisfied.
 */
function hasAccountContainerInPreNav(ctx: IPipelineContext): boolean {
  if (!ctx.mediator.has) return false;
  const preNav = ctx.mediator.value.network.getPreNavCaptures();
  return preNav.some((ep): boolean => {
    const body = ep.responseBody;
    if (body === null) return false;
    if (typeof body !== 'object') return false;
    const records = extractAccountRecords(body as Record<string, unknown>);
    return records.length > 0;
  });
}

/**
 * Returns true when the gate is OFF or no captures landed yet — the
 * caller must skip the check because a LATER auth phase will run it
 * with real data. Concretely: if pre-nav is empty AND no captures at
 * all are present, the trace listener hasn't started yet (boundary
 * not yet crossed). For non-OTP banks the gate flips ON at LOGIN
 * entry, so by LOGIN.FINAL the buckets are populated; for OTP banks
 * the gate flips ON at OTP-FILL entry, so LOGIN.FINAL skips and
 * OTP-FILL.FINAL enforces.
 * @param ctx - Pipeline context.
 * @returns True when the auth FINAL caller should skip enforcement.
 */
function shouldSkipPreNavCheck(ctx: IPipelineContext): boolean {
  if (!ctx.mediator.has) return true;
  const network = ctx.mediator.value.network;
  return network.getAllEndpoints().length === 0;
}

/**
 * Run the pre-nav readiness check from an auth FINAL action. Returns
 * a `Procedure` so callers can wrap the check into their existing
 * succeed/fail flow without ceremony.
 *
 * - Skips quietly when the gate hasn't produced any captures yet.
 *   The LATER auth phase will run the real check.
 * - Fails loud when captures ARE present but none carry an account
 *   container — that signals a broken login / dashboard render.
 * - Succeeds when an account container has landed in pre-nav.
 *
 * @param ctx - Pipeline context entering an auth FINAL stage.
 * @param phaseLabel - Phase name for the failure message.
 * @returns Procedure carrying the unchanged context, or a failure.
 */
function verifyPreNavReadiness(
  ctx: IPipelineContext,
  phaseLabel: string,
): Procedure<IPipelineContext> {
  if (shouldSkipPreNavCheck(ctx)) return succeed(ctx);
  if (hasAccountContainerInPreNav(ctx)) return succeed(ctx);
  const message =
    `${phaseLabel} FINAL: no account/cards container in pre-nav captures — ` +
    'auth completed but dashboard render produced no account info';
  return fail(ScraperErrorTypes.Generic, message);
}

export { hasAccountContainerInPreNav, shouldSkipPreNavCheck, verifyPreNavReadiness };
