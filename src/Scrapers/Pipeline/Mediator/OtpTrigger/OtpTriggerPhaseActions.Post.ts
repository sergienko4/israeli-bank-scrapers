/**
 * OTP-TRIGGER POST — scope-bound validation: re-probe the click target
 * disappearance and scan post-click network captures for an auth 2xx.
 */

import type { IPipelineContext, IResolvedTarget } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../Network/NetworkDiscoveryTypes.js';
import { readDiagTarget } from '../Otp/OtpShared.js';
import { OTP_TRIGGER_GONE_PROBE_TIMEOUT_MS } from '../Timing/TimingConfig.js';

/**
 * Read the `triggerClickedAt` timestamp the action stamped in
 * diagnostics. Falls back to `0` when missing.
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
 * Generic auth-domain URL-scope keywords for ACK detection.
 * <p>Keywords: `auth`, `otp`, `sms`, `verif`, `login` (SPA conventions).
 */
const AUTH_DOMAIN_URL_SCOPE = /auth|otp|sms|verif|login/i;

/**
 * Extract the pathname of a URL.
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
 * status, AND its URL matches an auth-domain scope keyword.
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

/** Promise<boolean> alias keeping single-line signatures. */
type Bool = Promise<boolean>;

/**
 * Re-probe whether the {@link IResolvedTarget} ACTION clicked is still
 * visible. Rejected/timed-out re-probe is UNKNOWN, not "target gone".
 * @param mediator - Element mediator for the re-resolve.
 * @param target - Target ACTION previously clicked.
 * @returns True iff the re-probe resolved AND target no longer found.
 */
async function reProbeTargetGone(mediator: IElementMediator, target: IResolvedTarget): Bool {
  const candidate = { kind: 'css' as const, value: target.selector };
  const probe = await mediator
    .resolveVisible([candidate], OTP_TRIGGER_GONE_PROBE_TIMEOUT_MS)
    .catch((): false => false);
  if (probe === false) return false;
  return !probe.found;
}

/**
 * Verify the trigger's effect within ACTION's scope. Logical-OR of
 * post-click 2xx ACK and trigger-gone re-probe.
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

/** Procedure alias keeping single-line signatures. */
type PostProc = Procedure<IPipelineContext>;

/** Bundled args for {@link commitTriggerPost}. */
interface ICommitPostArgs {
  readonly input: IPipelineContext;
  readonly wasScopeValidated: boolean;
  readonly triggerClickedAt: number;
}

/**
 * Emit the POST scope-validation telemetry and stamp the
 * `triggerScopeValidated` diagnostic.
 * @param args - Bundle of context + scope-validation outcome + click epoch.
 * @returns Success with updated diagnostics.
 */
function commitTriggerPost(args: ICommitPostArgs): PostProc {
  const { input, wasScopeValidated, triggerClickedAt } = args;
  input.logger.debug({
    event: 'otp-trigger.post.scope',
    scopeValidated: wasScopeValidated,
    triggerClickedAtMs: triggerClickedAt,
  });
  const diag = { ...input.diagnostics, triggerScopeValidated: wasScopeValidated };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * Build the no-target POST commit — stamps `triggerScopeValidated=false`.
 * @param input - Pipeline context.
 * @returns Success with the no-target diagnostics patch.
 */
function commitNoTargetTriggerPost(input: IPipelineContext): PostProc {
  const diag = { ...input.diagnostics, triggerScopeValidated: false };
  return succeed({ ...input, diagnostics: diag });
}

/**
 * POST: Verify the trigger's scope-bound effect.
 * @param input - Pipeline context.
 * @returns Updated context with `triggerScopeValidated` diagnostic.
 */
async function executeTriggerPost(input: IPipelineContext): Promise<PostProc> {
  if (!input.mediator.has) return succeed(input);
  const target = readDiagTarget(input.diagnostics, 'otpTriggerTarget');
  if (!target) return commitNoTargetTriggerPost(input);
  const triggerClickedAt = readTriggerClickedAt(input.diagnostics);
  const wasScopeValidated = await probeTriggerScope(input.mediator.value, target, triggerClickedAt);
  return commitTriggerPost({ input, wasScopeValidated, triggerClickedAt });
}

export default executeTriggerPost;
