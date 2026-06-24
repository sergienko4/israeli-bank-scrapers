/**
 * AUTH-DISCOVERY telemetry + snapshot helpers.
 *
 * <p>Co-located with {@link ./AuthDiscoveryActions.ts} (Phase 2d
 * strict-cluster split). Houses pure-data builders + side-effect
 * loggers so the entry-point file stays a thin orchestrator and
 * each function fits the 10-LoC ceiling.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type {
  AuthDiscoveryFailCode,
  IAuthDiscovery,
  IPipelineContext,
} from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail } from '../../Types/Procedure.js';
import type { collectAuthChannels, probeDashboardSignal } from './AuthDiscoveryProbes.js';

/**
 * Build the slim {@link IAuthDiscovery} value from the collected
 * inputs. Pure — no side effects.
 * @param channels - Collected auth channels.
 * @param dashboardReady - Result of the reveal probe.
 * @param sessionCookieNames - Session cookie names from the audit.
 * @returns Slim auth discovery snapshot.
 */
function buildSnapshot(
  channels: Awaited<ReturnType<typeof collectAuthChannels>>,
  dashboardReady: boolean,
  sessionCookieNames: readonly string[],
): IAuthDiscovery {
  const { authToken, origin, siteId, headers } = channels;
  return { authToken, origin, siteId, headers, dashboardReady, sessionCookieNames };
}

/**
 * Build the canonical PII-safe summary for an {@link IAuthDiscovery}
 * snapshot: booleans + counts only (no header values, no token, no
 * cookie values). Reused by POST/FINAL telemetry events so the wire
 * shape stays identical.
 *
 * @param snap - Slim auth-discovery snapshot.
 * @returns Plain key/value record ready for the logger sink.
 */
function buildAuthDiscoverySummary(snap: IAuthDiscovery): Record<string, boolean | number> {
  return {
    dashboardReady: snap.dashboardReady,
    hasAuthToken: snap.authToken !== false,
    hasOrigin: snap.origin !== false,
    hasSiteId: snap.siteId !== false,
    sessionCookieCount: snap.sessionCookieNames.length,
  };
}

/**
 * Emit POST-validated telemetry — PII-safe (booleans + counts only,
 * no header values, no token, no cookie values).
 * @param input - Pipeline context (for the logger handle).
 * @param snapshot - Built snapshot to summarise.
 * @param revealString - Reveal probe result (already mask-safe per
 *   `probeDashboardReveal` contract).
 * @returns True after the event is logged.
 */
function logPostValidated(
  input: IPipelineContext,
  snapshot: IAuthDiscovery,
  revealString: string,
): true {
  const summary = buildAuthDiscoverySummary(snapshot);
  input.logger.debug({ event: 'auth-discovery.post.validated', ...summary, revealString });
  return true;
}

/** Bundled args for {@link buildAndLogSnapshot}. */
interface ISnapshotBuildArgs {
  readonly input: IPipelineContext;
  readonly channels: Awaited<ReturnType<typeof collectAuthChannels>>;
  readonly reveal: Awaited<ReturnType<typeof probeDashboardSignal>>;
  readonly cookieNames: readonly string[];
}

/**
 * Build the slim {@link IAuthDiscovery} snapshot and emit the
 * POST-validated telemetry line. Returns the snapshot so callers
 * can commit it to the pipeline context.
 *
 * @param args - Bundled context + channels + reveal + cookie names.
 * @returns The freshly built snapshot.
 */
function buildAndLogSnapshot(args: ISnapshotBuildArgs): IAuthDiscovery {
  const { input, channels, reveal, cookieNames } = args;
  const snapshot = buildSnapshot(channels, reveal.dashboardReady, cookieNames);
  logPostValidated(input, snapshot, reveal.revealString);
  return snapshot;
}

/**
 * Emit the canonical `auth-discovery.committed` telemetry event so
 * `pipeline.log` carries a single PII-safe summary line per live run.
 *
 * @param input - Pipeline context (logger handle).
 * @param snap - Slim {@link IAuthDiscovery} snapshot from POST.
 * @returns True after the event is logged.
 */
function emitCommittedTelemetry(input: IPipelineContext, snap: IAuthDiscovery): true {
  const summary = buildAuthDiscoverySummary(snap);
  input.logger.debug({ event: 'auth-discovery.committed', ...summary });
  return true;
}

/**
 * Construct a fail-loud Procedure with a structured AUTH-DISCOVERY
 * fail code embedded in the message. ScraperErrorTypes.Generic is
 * the carrier — the fail code lives in the message so callers can
 * grep for it.
 *
 * @param code - One of the {@link AuthDiscoveryFailCode} enum values.
 * @param reason - Short diagnostic string (no PII).
 * @returns Failure Procedure.
 */
function failAuthDiscovery(
  code: AuthDiscoveryFailCode,
  reason: string,
): Procedure<IPipelineContext> {
  const msg = `AUTH-DISCOVERY POST: ${code} — ${reason}`;
  return fail(ScraperErrorTypes.Generic, msg);
}

export type { ISnapshotBuildArgs };
export {
  buildAndLogSnapshot,
  buildAuthDiscoverySummary,
  buildSnapshot,
  emitCommittedTelemetry,
  failAuthDiscovery,
  logPostValidated,
};

export type { IGateDecisionLog } from './AuthDiscoveryGateTelemetry.js';
export { logGateDecision } from './AuthDiscoveryGateTelemetry.js';
