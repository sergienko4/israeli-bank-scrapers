/**
 * OTP Trigger phase Mediator — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    passive — detect trigger button + phone hint + screenshot
 * ACTION: executioner — click trigger via discovered target
 * POST:   validate — screenshot + verify trigger completed
 * FINAL:  handoff — pass contextId + phoneHint to OtpFill phase
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import { some } from '../../Types/Option.js';
import type {
  IActionContext,
  IOtpTrigger,
  IPipelineContext,
  IResolvedTarget,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, succeed } from '../../Types/Procedure.js';
import { raceResultToTarget } from '../Elements/ActionExecutors.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { traceResolution } from '../Elements/ResolutionTrace.js';
import { detectOtpTrigger } from '../Form/OtpProbe.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { OTP_FALLBACK, readDiagTarget, unwrapProbe } from '../Otp/OtpShared.js';
import {
  OTP_PHASE_SETTLE_TIMEOUT_MS,
  OTP_TRIGGER_GONE_PROBE_TIMEOUT_MS,
} from '../Timing/TimingConfig.js';

/** Full masked phone pattern (e.g. *****1234 or ******0). */
const PHONE_HINT_PATTERN = /\*{3,7}\d{1,4}/;
/** Last 1-4 digits extractor. */
const PHONE_LAST_DIGITS = /(\d{1,4})$/;

// ── PRE: Passive Discovery (Rule #20) ──────────────────────────────

/**
 * Extract phone hint (last 3-4 digits) from main page text.
 * @param input - Pipeline context.
 * @returns Last digits or empty.
 */
async function extractPhoneHint(input: IPipelineContext): Promise<string> {
  if (!input.browser.has) return '';
  const page = input.browser.value.page;
  const bodyText = await page
    .evaluate((): string => document.body.innerText)
    .catch((): string => '');
  const fullMatch = PHONE_HINT_PATTERN.exec(bodyText);
  if (!fullMatch) return '';
  const digits = PHONE_LAST_DIGITS.exec(fullMatch[0]);
  if (!digits) return '';
  return digits[1];
}

/**
 * PRE: Detect OTP trigger button — 100% passive.
 * Takes screenshot, probes WK trigger patterns, extracts phone hint.
 * @param input - Pipeline context.
 * @returns Updated context with trigger discovery in diagnostics.
 */
async function executeTriggerPre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return succeed(input);
  if (!input.browser.has) return succeed(input);
  const mediator = input.mediator.value;
  const page = input.browser.value.page;
  const triggerResult = unwrapProbe(await detectOtpTrigger(mediator).catch(OTP_FALLBACK));
  traceResolution(input.logger, 'OTP_TRIGGER.PRE', triggerResult);
  const triggerTarget = raceResultToTarget(triggerResult, page);
  const phoneHint = await extractPhoneHint(input);
  input.logger.debug({
    message: `phone-hint: ${maskVisibleText(phoneHint)}`,
  });
  const hasTrigger: boolean = triggerResult.found;
  const isMockMode = process.env.MOCK_MODE === '1' || process.env.MOCK_MODE === 'true';
  if (!hasTrigger && !isMockMode) {
    return fail(ScraperErrorTypes.Generic, 'OTP trigger not detected');
  }
  const diag = {
    ...input.diagnostics,
    lastAction: `otp-trigger-pre (found=${String(hasTrigger)})`,
    otpTriggerTarget: triggerTarget,
    otpPhoneHint: phoneHint,
  };
  return succeed({ ...input, diagnostics: diag });
}

// ── ACTION: Click Trigger ─────────────────────────────────────────

/**
 * ACTION (sealed): Click the OTP trigger button.
 * Hand follows Eye — uses exact contextId + selector from PRE.
 * @param input - Sealed action context.
 * @returns Updated context or failure.
 */
async function executeTriggerAction(input: IActionContext): Promise<Procedure<IActionContext>> {
  if (!input.executor.has) return succeed(input);
  const executor = input.executor.value;
  const target = readDiagTarget(input.diagnostics, 'otpTriggerTarget');
  if (!target) {
    return fail(ScraperErrorTypes.Generic, 'OTP trigger — no target from PRE');
  }
  const didClick = await executor
    .clickElement({ contextId: target.contextId, selector: target.selector })
    .then((): true => true)
    .catch((): false => false);
  input.logger.debug({
    message: `trigger-otp: ${String(didClick)} @ ${target.contextId}`,
  });
  if (!didClick) {
    return fail(ScraperErrorTypes.Generic, 'OTP trigger failed — SMS not sent');
  }
  await executor.waitForNetworkIdle(OTP_PHASE_SETTLE_TIMEOUT_MS).catch((): false => false);
  // M4 — capture the wall-clock deadline for the POST scope-bound
  // validator. POST filters network captures whose `timestamp` is
  // >= triggerClickedAt to find the SMS-trigger ACK response.
  const triggerClickedAt = Date.now();
  const diag = { ...input.diagnostics, triggerClickedAt };
  return succeed({ ...input, diagnostics: diag });
}

// ── POST: Scope-bound validation ──────────────────────────────────

/**
 * Read the `triggerClickedAt` timestamp the action stamped in
 * diagnostics. Falls back to `0` when missing — POST then treats
 * EVERY capture as candidate which keeps the validator permissive
 * in test paths that don't run the full ACTION → POST sequence.
 *
 * @param diag - Pipeline diagnostics record.
 * @returns Click epoch-ms or 0.
 */
function readTriggerClickedAt(diag: IPipelineContext['diagnostics']): number {
  const raw = (diag as unknown as { readonly triggerClickedAt?: unknown }).triggerClickedAt;
  if (typeof raw !== 'number') return 0;
  return raw;
}

/** HTTP 2xx range used by the auth-domain ACK detector. */
const HTTP_2XX_LO = 200;
/** HTTP 2xx range — inclusive upper bound. */
const HTTP_2XX_HI = 299;

/**
 * Predicate: capture occurred since `triggerClickedAt` AND has a 2xx
 * status. Used to detect the bank's SMS-trigger ACK response.
 *
 * @param ep - Discovered endpoint to check.
 * @param sinceMs - Lower bound (ms epoch).
 * @returns True when the capture is a post-click 2xx.
 */
function isPostClickAck(ep: IDiscoveredEndpoint, sinceMs: number): boolean {
  if (ep.timestamp < sinceMs) return false;
  if (ep.status === undefined) return false;
  if (ep.status < HTTP_2XX_LO) return false;
  return ep.status <= HTTP_2XX_HI;
}

/**
 * Verify the trigger's effect within ACTION's scope. Two signals
 * (logical OR) — either is enough:
 * <ul>
 *   <li>≥ 1 post-click 2xx network capture (the SMS-trigger ACK
 *       response, regardless of bank).</li>
 *   <li>The same `otpTriggerTarget` ACTION clicked is no longer
 *       visible (SPA replaced the trigger panel with the OTP-fill
 *       form).</li>
 * </ul>
 * The ACK check runs first because it's free (in-memory capture
 * scan); the visibility re-probe runs only when no ACK fired.
 *
 * @param mediator - Element mediator for re-resolving the target.
 * @param target - Target ACTION clicked.
 * @param triggerClickedAt - Click epoch-ms.
 * @returns True when at least one scope signal fires.
 */
async function probeTriggerScope(
  mediator: IElementMediator,
  target: IResolvedTarget,
  triggerClickedAt: number,
): Promise<boolean> {
  const captures = mediator.network.getAllEndpoints();
  const hasAck = captures.some((ep): boolean => isPostClickAck(ep, triggerClickedAt));
  if (hasAck) return true;
  const candidate = { kind: 'css' as const, value: target.selector };
  const probe = await mediator
    .resolveVisible([candidate], OTP_TRIGGER_GONE_PROBE_TIMEOUT_MS)
    .catch((): false => false);
  if (probe === false) return true;
  return !probe.found;
}

// ── POST: Scope-bound validation (M4) ─────────────────────────────

/**
 * POST: Verify the trigger's scope-bound effect — re-resolve the
 * `otpTriggerTarget` and check post-click captures for a 2xx ACK.
 * Stamps `triggerScopeValidated` in diagnostics; never fails loud
 * (the validation is observability, not gating — OTP-FILL's own
 * fill+submit is the real consumer).
 *
 * @param input - Pipeline context.
 * @returns Updated context with `triggerScopeValidated` diagnostic.
 */
async function executeTriggerPost(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has) return succeed(input);
  const target = readDiagTarget(input.diagnostics, 'otpTriggerTarget');
  if (!target) {
    const diag = { ...input.diagnostics, triggerScopeValidated: false };
    return succeed({ ...input, diagnostics: diag });
  }
  const triggerClickedAt = readTriggerClickedAt(input.diagnostics);
  const wasScopeValidated = await probeTriggerScope(input.mediator.value, target, triggerClickedAt);
  input.logger.debug({
    event: 'otp-trigger.post.scope',
    scopeValidated: wasScopeValidated,
    triggerClickedAtMs: triggerClickedAt,
  });
  const diag = { ...input.diagnostics, triggerScopeValidated: wasScopeValidated };
  return succeed({ ...input, diagnostics: diag });
}

// ── FINAL: Emit ctx.otpTrigger (M4) ───────────────────────────────

/**
 * Read the boolean `triggerScopeValidated` POST stamped. Falls back
 * to `false` when missing — FINAL never fabricates a positive
 * validation it didn't actually observe.
 *
 * @param diag - Pipeline diagnostics record.
 * @returns Stamped boolean or false.
 */
function readScopeValidated(diag: IPipelineContext['diagnostics']): boolean {
  const raw = (diag as unknown as { readonly triggerScopeValidated?: unknown })
    .triggerScopeValidated;
  if (typeof raw !== 'boolean') return false;
  return raw;
}

/**
 * Read the `otpPhoneHint` PRE stamped. Falls back to `''` when
 * missing — every consumer treats empty-string as "no hint".
 *
 * @param diag - Pipeline diagnostics record.
 * @returns Stamped string or `''`.
 */
function readPhoneHint(diag: IPipelineContext['diagnostics']): string {
  const raw = (diag as unknown as { readonly otpPhoneHint?: unknown }).otpPhoneHint;
  if (typeof raw !== 'string') return '';
  return raw;
}

/**
 * FINAL: Emit `ctx.otpTrigger` with the slim {@link IOtpTrigger}
 * value type. Mirrors the AUTH-DISCOVERY/ACCOUNT-RESOLVE FINAL
 * pattern — single source of truth for downstream consumers.
 *
 * @param input - Pipeline context.
 * @returns Updated context with `otpTrigger` populated.
 */
function executeTriggerFinal(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  const phoneHint = readPhoneHint(input.diagnostics);
  const target = readDiagTarget(input.diagnostics, 'otpTriggerTarget');
  const wasScopeValidated = readScopeValidated(input.diagnostics);
  const wasTriggered: boolean = target !== false;
  const snapshot: IOtpTrigger = {
    phoneHint,
    triggered: wasTriggered,
    scopeValidated: wasScopeValidated,
  };
  input.logger.debug({
    event: 'otp-trigger.committed',
    triggered: snapshot.triggered,
    scopeValidated: snapshot.scopeValidated,
    phoneHintLength: phoneHint.length,
  });
  const diag = { ...input.diagnostics, lastAction: 'otp-trigger-final (committed)' };
  const nextCtx = {
    ...input,
    diagnostics: diag,
    otpTrigger: some(snapshot),
  };
  const result = succeed(nextCtx);
  return Promise.resolve(result);
}

export { executeTriggerAction, executeTriggerFinal, executeTriggerPost, executeTriggerPre };
