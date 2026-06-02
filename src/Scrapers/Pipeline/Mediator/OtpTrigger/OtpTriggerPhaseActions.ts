/**
 * OTP Trigger phase Mediator — PRE/ACTION/POST/FINAL.
 * Phase orchestrates ONLY. All logic here.
 *
 * PRE:    passive — detect trigger button + phone hint + screenshot
 * ACTION: executioner — click trigger via discovered target
 * POST:   validate — screenshot + verify trigger completed
 * FINAL:  handoff — pass contextId + phoneHint to OtpFill phase
 */

import type { Page } from 'playwright-core';

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
import type { IActionMediator, IElementMediator } from '../Elements/ElementMediator.js';
import { traceResolution } from '../Elements/ResolutionTrace.js';
import { detectOtpTrigger } from '../Form/OtpProbe.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { PHONE_HINT_PATTERN, PHONE_LAST_DIGITS } from '../Otp/OtpDetectorConfig.js';
import { OTP_FALLBACK, readDiagTarget, unwrapProbe } from '../Otp/OtpShared.js';
import {
  OTP_PHASE_SETTLE_TIMEOUT_MS,
  OTP_TRIGGER_GONE_PROBE_TIMEOUT_MS,
} from '../Timing/TimingConfig.js';

// PHONE_HINT_PATTERN + PHONE_LAST_DIGITS imported from OtpDetectorConfig
// (CR PR #286 F4 — single source of truth shared with OtpFillPhaseActions).

// ── PRE: Passive Discovery (Rule #20) ──────────────────────────────

/**
 * Read the visible body text of the main page so the phone-hint
 * regexes can pattern-match. Returns empty string when the page
 * isn't attached or {@link Page.evaluate} rejects (mid-navigation,
 * detached frame, etc.).
 *
 * @param input - Pipeline context carrying the optional browser.
 * @returns Body inner text or `''` when unavailable.
 */
async function readPageBodyText(input: IPipelineContext): Promise<string> {
  if (!input.browser.has) return '';
  return input.browser.value.page
    .evaluate((): string => document.body.innerText)
    .catch((): string => '');
}

/**
 * Match the phone-hint pattern against the page body and pull out the
 * last 3-4 digits substring captured by {@link PHONE_LAST_DIGITS}.
 *
 * @param bodyText - Visible body text of the main page.
 * @returns Last digits captured from the hint, or `''` when no match.
 */
function extractLastDigitsFromBody(bodyText: string): string {
  const fullMatch = PHONE_HINT_PATTERN.exec(bodyText);
  if (!fullMatch) return '';
  const digits = PHONE_LAST_DIGITS.exec(fullMatch[0]);
  if (!digits) return '';
  return digits[1];
}

/**
 * Extract phone hint (last 3-4 digits) from main page text.
 * @param input - Pipeline context.
 * @returns Last digits or empty.
 */
async function extractPhoneHint(input: IPipelineContext): Promise<string> {
  const bodyText = await readPageBodyText(input);
  if (!bodyText) return '';
  return extractLastDigitsFromBody(bodyText);
}

/** Bundled outcome of {@link probeTriggerForPre}. */
interface ITriggerProbeOutcome {
  readonly hasTrigger: boolean;
  readonly triggerTarget: IResolvedTarget | false;
}

/** Bundled args for {@link probeTriggerForPre} — keeps params ≤3 and avoids
 * passing a non-narrowed Option (the page is already unwrapped). */
interface IProbeTriggerArgs {
  readonly mediator: IElementMediator;
  readonly page: Page;
  readonly logger: IPipelineContext['logger'];
}

/**
 * Probe the page for the OTP-trigger element, trace the resolution for
 * forensic logs, and convert the race result to a click target.
 * Extracted so {@link executeTriggerPre} stays a thin orchestrator.
 *
 * @param args - Bundle of mediator, page, and pipeline logger.
 * @returns Probe outcome with `hasTrigger` flag and resolved target.
 */
async function probeTriggerForPre(args: IProbeTriggerArgs): Promise<ITriggerProbeOutcome> {
  const triggerResult = unwrapProbe(await detectOtpTrigger(args.mediator).catch(OTP_FALLBACK));
  traceResolution(args.logger, 'OTP_TRIGGER.PRE', triggerResult);
  const triggerTarget = raceResultToTarget(triggerResult, args.page);
  return { hasTrigger: triggerResult.found, triggerTarget };
}

/** Truthy MOCK_MODE values accepted at PRE for skipping the no-trigger fail. */
const MOCK_MODE_TRUTHY: ReadonlySet<string> = new Set(['1', 'true']);

/**
 * Returns true when the MOCK_MODE env-var is set to a truthy value.
 * Centralised so the predicate is greppable and matches the
 * canonical truthy set ({@link MOCK_MODE_TRUTHY}).
 *
 * @returns Whether mock-mode short-circuits the no-trigger fail.
 */
function isMockModeEnabled(): boolean {
  const raw = process.env.MOCK_MODE;
  if (raw === undefined) return false;
  return MOCK_MODE_TRUTHY.has(raw);
}

/** Bundled args for {@link buildTriggerPreDiag} — keeps params ≤3. */
interface IPreDiagArgs {
  readonly triggerTarget: IResolvedTarget | false;
  readonly phoneHint: string;
  readonly otpTriggerPreUrl: string;
  readonly hasTrigger: boolean;
}

/**
 * Compose the PRE-stage diagnostics patch carrying the trigger probe
 * outcome, phone hint, and URL captured at PRE entry. Returned as a
 * new object so the caller's spread/succeed stays under the cap.
 *
 * @param input - Pipeline context (for existing diagnostics).
 * @param args - Bundled PRE outputs to stamp.
 * @returns New diagnostics record.
 */
function buildTriggerPreDiag(
  input: IPipelineContext,
  args: IPreDiagArgs,
): IPipelineContext['diagnostics'] {
  const lastAction = `otp-trigger-pre (found=${String(args.hasTrigger)})`;
  const extras: Record<string, unknown> = {
    otpTriggerTarget: args.triggerTarget,
    otpPhoneHint: args.phoneHint,
    otpTriggerPreUrl: args.otpTriggerPreUrl,
  };
  return { ...input.diagnostics, lastAction, ...extras };
}

/** Bundled inputs for {@link finalizeTriggerPre} — keeps params ≤3. */
interface IFinalizePreArgs {
  readonly hasTrigger: boolean;
  readonly triggerTarget: IResolvedTarget | false;
  readonly phoneHint: string;
}

/**
 * Stamp PRE diagnostics or fail loudly when no trigger was detected.
 * Mock-mode short-circuits the fail so unit harnesses can drive ACTION
 * without first satisfying the probe. Extracted to keep PRE ≤10 LoC.
 *
 * @param input - Pipeline context.
 * @param mediator - Element mediator (for current URL).
 * @param args - PRE outputs (trigger probe result + phone hint).
 * @returns Failure when no trigger, otherwise context with PRE diag.
 */
function finalizeTriggerPre(
  input: IPipelineContext,
  mediator: IElementMediator,
  args: IFinalizePreArgs,
): Procedure<IPipelineContext> {
  if (!args.hasTrigger && !isMockModeEnabled()) {
    return fail(ScraperErrorTypes.Generic, 'OTP trigger not detected');
  }
  const otpTriggerPreUrl = mediator.getCurrentUrl();
  const diag = buildTriggerPreDiag(input, { ...args, otpTriggerPreUrl });
  return succeed({ ...input, diagnostics: diag });
}

/**
 * PRE: Detect OTP trigger button — 100% passive.
 * Takes screenshot, probes WK trigger patterns, extracts phone hint.
 * @param input - Pipeline context.
 * @returns Updated context with trigger discovery in diagnostics.
 */
async function executeTriggerPre(input: IPipelineContext): Promise<Procedure<IPipelineContext>> {
  if (!input.mediator.has || !input.browser.has) return succeed(input);
  const mediator = input.mediator.value;
  const page = input.browser.value.page;
  const probe = await probeTriggerForPre({ mediator, page, logger: input.logger });
  const phoneHint = await extractPhoneHint(input);
  input.logger.debug({ message: `phone-hint: ${maskVisibleText(phoneHint)}` });
  return finalizeTriggerPre(input, mediator, { ...probe, phoneHint });
}

// ── ACTION: Click Trigger ─────────────────────────────────────────

/** Bundled args for {@link clickOtpTrigger} — keeps params ≤3. */
interface IClickTriggerArgs {
  readonly executor: IActionMediator;
  readonly target: IResolvedTarget;
  readonly logger: IPipelineContext['logger'];
}

/**
 * Click the resolved OTP-trigger target and log the outcome. Swallows
 * Playwright auto-wait rejections so callers can branch on the boolean
 * rather than try/catch.
 *
 * @param args - Bundle of executor, click target, pipeline logger.
 * @returns True iff the click resolved without rejecting.
 */
async function clickOtpTrigger(args: IClickTriggerArgs): Promise<boolean> {
  const { executor, target, logger } = args;
  const didClick = await executor
    .clickElement({ contextId: target.contextId, selector: target.selector })
    .then((): true => true)
    .catch((): false => false);
  logger.debug({ message: `trigger-otp: ${String(didClick)} @ ${target.contextId}` });
  return didClick;
}

/**
 * Stamp the click deadline IMMEDIATELY AFTER the click succeeds, BEFORE
 * the network-idle settle wait. Any 2xx ACK landing during the wait
 * window has its timestamp ≥ `triggerClickedAt` and is correctly
 * recognised by {@link isPostClickAck} (PR #221 review finding A.1).
 *
 * @param executor - Sealed action mediator.
 * @returns Epoch-ms captured BEFORE the settle wait begins.
 */
async function captureClickedAtAndSettle(executor: IActionMediator): Promise<number> {
  const triggerClickedAt = Date.now();
  await executor.waitForNetworkIdle(OTP_PHASE_SETTLE_TIMEOUT_MS).catch((): false => false);
  return triggerClickedAt;
}

/**
 * Perform the actual trigger click, capture the click deadline, and
 * stamp `triggerClickedAt` into diagnostics. Extracted so the public
 * {@link executeTriggerAction} entry-point remains ≤10 LoC.
 *
 * @param input - Sealed action context.
 * @param args - Bundle of executor, target, and pipeline logger.
 * @returns Updated context on click success, failure on click reject.
 */
async function performTriggerClickAndStamp(
  input: IActionContext,
  args: IClickTriggerArgs,
): Promise<Procedure<IActionContext>> {
  const didClick = await clickOtpTrigger(args);
  if (!didClick) return fail(ScraperErrorTypes.Generic, 'OTP trigger failed — SMS not sent');
  const triggerClickedAt = await captureClickedAtAndSettle(args.executor);
  const diag = { ...input.diagnostics, triggerClickedAt };
  return succeed({ ...input, diagnostics: diag });
}

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
  if (!target) return fail(ScraperErrorTypes.Generic, 'OTP trigger — no target from PRE');
  return performTriggerClickAndStamp(input, { executor, target, logger: input.logger });
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
  const raw = diag.triggerClickedAt;
  if (typeof raw !== 'number') return 0;
  return raw;
}

/** HTTP 2xx range used by the auth-domain ACK detector. */
const HTTP_2XX_LO = 200;
/** HTTP 2xx range — inclusive upper bound. */
const HTTP_2XX_HI = 299;

/**
 * Generic auth-domain URL-scope keywords. The OTP-trigger ACK MUST
 * match an auth-flow URL pattern; without this constraint the
 * predicate would promote any post-click 2xx (analytics, dashboard
 * data, balance fetches, background polling, etc.) to a valid ACK
 * → false positive on `scopeValidated`. PR #221 review finding A.2.
 *
 * <p>Keywords are SPA conventions, not bank-specific markers:
 *   - `auth` / `authenticate` / `authentication`
 *   - `otp` (sendOtp, otpPrepare, otpSubmit, …)
 *   - `sms` (sendSms, smsSubmit, …)
 *   - `verif` (verification, verify, …)
 *   - `login` (loginSuccess, login/login, …)
 *
 * <p>Substring (case-insensitive) — Camel/PascalCase URL segments are
 * accepted (no `\b` so `sendOtp` matches `otp`).
 *
 * <p>Tested against {@link pathnameOf}-extracted URL paths only (NOT
 * the full URL). PR #221 review (id 3215182688) — rejects false
 * positives where the keyword lives in the host (`login.example.com`)
 * or the query string (`?from=login`). Path-shape false positives
 * (`/sms-templates`) remain acceptable for an observability-only gate.
 */
const AUTH_DOMAIN_URL_SCOPE = /auth|otp|sms|verif|login/i;

/**
 * Extract the pathname of a URL. Falls back to the raw input on parse
 * failure so the caller never sees a thrown exception (the predicate
 * is observability-only — a malformed URL should NOT crash POST).
 *
 * @param url - Endpoint URL.
 * @returns URL pathname or raw input on failure.
 */
function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * Predicate: capture occurred since `triggerClickedAt`, has a 2xx
 * status, AND its URL matches an auth-domain scope keyword. Used to
 * detect the bank's SMS-trigger ACK response while rejecting
 * coincidental post-click 2xx traffic (analytics, dashboard, etc.).
 *
 * @param ep - Discovered endpoint to check.
 * @param sinceMs - Lower bound (ms epoch).
 * @returns True when the capture is a post-click auth-domain 2xx.
 */
function isPostClickAck(ep: IDiscoveredEndpoint, sinceMs: number): boolean {
  if (ep.timestamp < sinceMs) return false;
  if (ep.status === undefined) return false;
  if (ep.status < HTTP_2XX_LO) return false;
  if (ep.status > HTTP_2XX_HI) return false;
  const path = pathnameOf(ep.url);
  return AUTH_DOMAIN_URL_SCOPE.test(path);
}

/**
 * Re-probe whether the {@link IResolvedTarget} ACTION clicked is still
 * visible. A rejected/timed-out re-probe is UNKNOWN, not "target gone"
 * — stamping `true` here would mark `scopeValidated=true` without ever
 * proving the trigger disappeared (PR #221 review finding B.2 — false
 * positive on transient resolver failures).
 *
 * @param mediator - Element mediator for the re-resolve.
 * @param target - Target ACTION previously clicked.
 * @returns True iff the re-probe resolved AND the target is no longer found.
 */
async function reProbeTargetGone(
  mediator: IElementMediator,
  target: IResolvedTarget,
): Promise<boolean> {
  const candidate = { kind: 'css' as const, value: target.selector };
  const probe = await mediator
    .resolveVisible([candidate], OTP_TRIGGER_GONE_PROBE_TIMEOUT_MS)
    .catch((): false => false);
  if (probe === false) return false;
  return !probe.found;
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
  return reProbeTargetGone(mediator, target);
}

// ── POST: Scope-bound validation (M4) ─────────────────────────────

/**
 * Emit the POST scope-validation telemetry and stamp the
 * `triggerScopeValidated` diagnostic. Extracted so the orchestrator
 * stays under the project's 10-line ceiling.
 *
 * @param input - Pipeline context.
 * @param wasScopeValidated - Outcome of `probeTriggerScope`.
 * @param triggerClickedAt - Click epoch-ms (logged for trace).
 * @returns Success with updated diagnostics.
 */
function commitTriggerPost(
  input: IPipelineContext,
  wasScopeValidated: boolean,
  triggerClickedAt: number,
): Procedure<IPipelineContext> {
  input.logger.debug({
    event: 'otp-trigger.post.scope',
    scopeValidated: wasScopeValidated,
    triggerClickedAtMs: triggerClickedAt,
  });
  const diag = { ...input.diagnostics, triggerScopeValidated: wasScopeValidated };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * Build the no-target POST commit — stamps `triggerScopeValidated=false`
 * so downstream consumers never see an undefined diagnostic. Extracted
 * so {@link executeTriggerPost} stays a thin dispatcher.
 *
 * @param input - Pipeline context.
 * @returns Success with the no-target diagnostics patch.
 */
function commitNoTargetTriggerPost(input: IPipelineContext): Procedure<IPipelineContext> {
  const diag = { ...input.diagnostics, triggerScopeValidated: false };
  return succeed({ ...input, diagnostics: diag });
}

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
  if (!target) return commitNoTargetTriggerPost(input);
  const triggerClickedAt = readTriggerClickedAt(input.diagnostics);
  const wasScopeValidated = await probeTriggerScope(input.mediator.value, target, triggerClickedAt);
  return commitTriggerPost(input, wasScopeValidated, triggerClickedAt);
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
  const wasValidated = diag.triggerScopeValidated;
  if (typeof wasValidated !== 'boolean') return false;
  return wasValidated;
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
 * Build the slim {@link IOtpTrigger} snapshot from the accumulated
 * diagnostics. Pure — no side effects. SOLID: OTP-TRIGGER captures
 * its OWN `urlBeforeSubmit` at PRE entry (via `mediator.getCurrentUrl()`
 * in `executeTriggerPre`) — does NOT inherit from `ctx.login`,
 * because LOGIN.ACTION may have navigated the page (login form →
 * OTP form) before OTP-TRIGGER ran. Each phase owns its inputs.
 *
 * @param input - Pipeline context (carries OTP-TRIGGER.PRE captures).
 * @returns Slim OTP-TRIGGER value snapshot.
 */
function buildOtpTriggerSnapshot(input: IPipelineContext): IOtpTrigger {
  const target = readDiagTarget(input.diagnostics, 'otpTriggerTarget');
  return {
    phoneHint: readPhoneHint(input.diagnostics),
    triggered: target !== false,
    scopeValidated: readScopeValidated(input.diagnostics),
    urlBeforeSubmit: input.diagnostics.otpTriggerPreUrl ?? '',
  };
}

/**
 * Emit the FINAL commit telemetry and bind the snapshot to
 * `ctx.otpTrigger`. Extracted so the orchestrator stays under the
 * project's 10-line ceiling.
 *
 * @param input - Pipeline context.
 * @param snapshot - Pre-built OTP-TRIGGER snapshot.
 * @returns Success with updated context.
 */
function commitOtpTrigger(
  input: IPipelineContext,
  snapshot: IOtpTrigger,
): Procedure<IPipelineContext> {
  input.logger.debug({
    event: 'otp-trigger.committed',
    triggered: snapshot.triggered,
    scopeValidated: snapshot.scopeValidated,
    phoneHintLength: snapshot.phoneHint.length,
  });
  const diag = { ...input.diagnostics, lastAction: 'otp-trigger-final (committed)' };
  return succeed({ ...input, diagnostics: diag, otpTrigger: some(snapshot) });
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
  const snapshot = buildOtpTriggerSnapshot(input);
  const committed = commitOtpTrigger(input, snapshot);
  return Promise.resolve(committed);
}

export { executeTriggerAction, executeTriggerFinal, executeTriggerPost, executeTriggerPre };
