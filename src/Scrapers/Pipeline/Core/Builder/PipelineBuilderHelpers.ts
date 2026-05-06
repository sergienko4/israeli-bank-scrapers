/**
 * Pipeline builder helpers — build logic and interceptor assembly.
 * Extracted from PipelineBuilder.ts to respect max-lines.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createNetworkTraceLifecycleInterceptor } from '../../Interceptors/NetworkTraceLifecycleInterceptor.js';
import { createPopupInterceptor } from '../../Interceptors/PopupInterceptor.js';
import type { IPipelineInterceptor } from '../../Types/Interceptor.js';
import type { AccountDiscoveryAt } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IPipelineDescriptor } from '../PipelineDescriptor.js';
import type { IBuilderState } from './PipelineAssembly.js';
import { assemblePhases } from './PipelineAssembly.js';
import {
  assertRequiredFields,
  type IBuilderFields,
  toBuilderState,
} from './PipelineBuilderValidation.js';

/**
 * Resolve the trace-gate boundary phase — the phase IMMEDIATELY
 * BEFORE the last auth phase, so the listener is recording while the
 * auth phase's POST stage waits for the dashboard initial render
 * (where account info lands as network traffic).
 *
 * Mapping:
 * - OTP-fill bank, with trigger:        boundary = `otp-trigger`
 *                                       (gate ON at OTP-FILL entry)
 * - OTP-fill bank, no trigger (rare):   boundary = `login`
 * - OTP-trigger only (no fill):         boundary = `login`
 * - Non-OTP, with PRE-LOGIN form:       boundary = `pre-login`
 *                                       (gate ON at LOGIN entry)
 * - Non-OTP, no PRE-LOGIN:              boundary = `home`
 * - Headless / no login mode:           empty string (skip gate).
 * @param state - Validated builder state.
 * @returns Boundary phase name or empty string.
 */
/**
 * Decide which auth FINAL owns the call to the shared
 * account-discovery handler (wait-for-traffic + extract). OTP banks
 * defer to OTP-FILL.FINAL so the wait runs exactly once (no double-
 * wait at LOGIN.FINAL). Non-OTP browser banks own it at LOGIN.FINAL.
 * Headless / no-login pipelines skip discovery entirely.
 * @param state - Validated builder state.
 * @returns Pointer to the FINAL that owns the wait + discovery.
 */
function resolveAccountDiscoveryAt(state: IBuilderState): AccountDiscoveryAt {
  if (!state.hasBrowser) return 'none';
  if (state.loginMode === 'none') return 'none';
  if (state.hasOtpFill) return 'otp-fill';
  return 'login';
}

/**
 * Resolve the trace-gate boundary phase. Maps the builder state to
 * the phase name AFTER which the network listener flips ON, so the
 * pre-nav capture pool excludes login traffic but includes the
 * dashboard render. Empty string for headless / no-login pipelines.
 * @param state - Validated builder state.
 * @returns Boundary phase name or empty string.
 */
function resolveTraceBoundaryPhase(state: IBuilderState): string {
  if (!state.hasBrowser) return '';
  if (state.loginMode === 'none') return '';
  if (state.hasOtpFill && state.hasOtpTrigger) return 'otp-trigger';
  if (state.hasOtpFill) return 'login';
  if (state.hasOtpTrigger) return 'login';
  if (state.hasPreLogin) return 'pre-login';
  return 'home';
}

/**
 * Build interceptors for the descriptor. Browser banks always get the
 * network-trace lifecycle interceptor wired against the boundary
 * phase resolved from `state` so the discovery pool only contains
 * post-auth captures. Headless / test descriptors return empty.
 * @param state - Builder state.
 * @param phaseNames - Ordered phase names from `assemblePhases`.
 * @param boundary - Resolved boundary phase name (empty = skip gate).
 * @returns Interceptor list.
 */
function buildInterceptors(
  state: IBuilderState,
  phaseNames: readonly string[],
  boundary: string,
): readonly IPipelineInterceptor[] {
  if (!state.hasBrowser) return [];
  const list: IPipelineInterceptor[] = [createPopupInterceptor()];
  if (boundary !== '') {
    const traceGate = createNetworkTraceLifecycleInterceptor(phaseNames, boundary);
    list.push(traceGate);
  }
  return list;
}

/** Bundle of state needed to materialize a pipeline descriptor. */
interface IDescriptorParts {
  readonly options: ScraperOptions;
  readonly fields: IBuilderFields;
}

/**
 * Construct the pipeline descriptor object literal — extracted so
 * `buildDescriptor` stays under the per-function line budget.
 * @param parts - Validated state + options bundle.
 * @returns Pipeline descriptor.
 */
function assembleDescriptor(parts: IDescriptorParts): IPipelineDescriptor {
  const state = toBuilderState(parts.fields);
  const phases = assemblePhases(state);
  const boundary = resolveTraceBoundaryPhase(state);
  return {
    options: parts.options,
    phases,
    interceptors: buildInterceptorsFor(state, phases, boundary),
    isHeadless: parts.fields.isHeadless,
    traceStartAfterPhase: boundary,
    accountDiscoveryAt: resolveAccountDiscoveryAt(state),
  };
}

/**
 * Wire interceptors against the resolved phase ordering and trace
 * boundary. Inlined into `assembleDescriptor` would push that
 * function over the per-function line budget.
 * @param state - Builder state.
 * @param phases - Ordered phases.
 * @param boundary - Resolved trace boundary phase name.
 * @returns Interceptor list.
 */
function buildInterceptorsFor(
  state: IBuilderState,
  phases: readonly { readonly name: string }[],
  boundary: string,
): readonly IPipelineInterceptor[] {
  const phaseNames = phases.map((p): string => p.name);
  return buildInterceptors(state, phaseNames, boundary);
}

/**
 * Build a pipeline descriptor from validated fields.
 * @param fields - Raw builder fields.
 * @param options - Scraper options.
 * @returns Procedure with descriptor or validation failure.
 */
function buildDescriptor(
  fields: IBuilderFields,
  options: ScraperOptions,
): Procedure<IPipelineDescriptor> {
  const validation = assertRequiredFields(fields);
  if (!validation.success) return validation;
  const descriptor = assembleDescriptor({ options, fields });
  return succeed(descriptor);
}

export type { ScrapeFn } from './PipelineBuilderValidation.js';
export {
  buildDescriptor,
  buildInterceptors,
  resolveAccountDiscoveryAt,
  resolveTraceBoundaryPhase,
};
