/**
 * AUTH-DISCOVERY gate-decision telemetry.
 *
 * <p>Split from {@link ./AuthDiscoveryTelemetry.ts} to keep every
 * module under the 150-line hard cap (that file is already 139 lines).
 * Re-exported via the telemetry barrel so callers keep a single
 * import surface.
 *
 * <p>PII policy: both URL arguments are redacted through
 * {@link redactUrlFull} before they reach the logger — scheme + host
 * + path with digits scrubbed; raw URLs are never logged.
 */

import { redactUrlFull } from '../../Types/PiiRedactor.js';
import type { IPipelineContext } from '../../Types/PipelineContext.js';
import type { DashboardGateReason } from './AuthDiscoveryInterstitial.js';

/**
 * Bundled arguments for {@link logGateDecision}.
 * Uses a single-arg bundle to satisfy `max-params: 3`.
 */
interface IGateDecisionLog {
  readonly input: IPipelineContext;
  readonly reason: DashboardGateReason;
  readonly currentUrl: string;
  readonly preAuthUrl: string;
}

/**
 * Emit a PII-safe `auth-discovery.gate.decision` debug line.
 * Both URL arguments are redacted before reaching the logger.
 * Observability-only — no control-flow side effects.
 *
 * @param args - Bundled context + gate reason + URLs.
 * @returns True after the event is logged (enables one-line callers).
 */
function logGateDecision(args: IGateDecisionLog): true {
  args.input.logger.debug({
    event: 'auth-discovery.gate.decision',
    reason: args.reason,
    currentUrl: redactUrlFull(args.currentUrl),
    preAuthUrl: redactUrlFull(args.preAuthUrl),
  });
  return true;
}

export type { IGateDecisionLog };
export { logGateDecision };
