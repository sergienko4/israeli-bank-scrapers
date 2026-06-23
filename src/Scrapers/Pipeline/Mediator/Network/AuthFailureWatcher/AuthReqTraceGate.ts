/**
 * Auth request-level trace opt-in gate.
 *
 * <p>The auth-failure watcher is historically response-keyed, so a
 * credentials POST that leaves the browser but receives no response is
 * invisible to login diagnostics. This gate keeps request/requestfailed
 * forensics available for CI triage while preserving the WAF-safe default.
 *
 * <p>When {@link AUTH_REQ_TRACE_ENV_VAR} is OFF (default), no request
 * listeners are attached and production is byte-identical. When ON, the
 * watcher reuses the same login page that already owns the response
 * listener, minimizing Marionette-wire delta from the existing Network
 * domain activity.
 */

/** Env-var name that flips request-level auth tracing. */
export const AUTH_REQ_TRACE_ENV_VAR = 'PIPELINE_AUTH_REQ_TRACE';

/** String values of {@link AUTH_REQ_TRACE_ENV_VAR} that enable tracing. */
const ENABLED_VALUES: readonly string[] = Object.freeze(['1', 'true']);

/**
 * Branded gate state for request-level auth tracing.
 */
export interface IAuthReqTraceGateState {
  readonly enabled: boolean;
}

/** Singleton enabled-state. */
const GATE_ENABLED: IAuthReqTraceGateState = Object.freeze({ enabled: true });
/** Singleton disabled-state — the production default. */
const GATE_DISABLED: IAuthReqTraceGateState = Object.freeze({ enabled: false });

/**
 * Reads the current auth request trace gate state.
 *
 * @returns Enabled only for `'1'` or `'true'`; every other value keeps
 *   request-level listeners detached.
 */
export function readAuthReqTraceGate(): IAuthReqTraceGateState {
  const value = process.env[AUTH_REQ_TRACE_ENV_VAR];
  if (value === undefined) return GATE_DISABLED;
  if (ENABLED_VALUES.includes(value)) return GATE_ENABLED;
  return GATE_DISABLED;
}
