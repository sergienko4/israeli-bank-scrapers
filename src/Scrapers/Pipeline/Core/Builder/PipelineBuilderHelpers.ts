/**
 * Pipeline builder helpers — build logic and interceptor assembly.
 * Extracted from PipelineBuilder.ts to respect max-lines.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import { createNetworkTraceLifecycleInterceptor } from '../../Interceptors/NetworkTraceLifecycleInterceptor.js';
import { createPopupInterceptor } from '../../Interceptors/PopupInterceptor.js';
import type { IPipelineInterceptor } from '../../Types/Interceptor.js';
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
  const phaseNames = phases.map((p): string => p.name);
  const boundary = resolveTraceBoundaryPhase(state);
  const interceptors = buildInterceptors(state, phaseNames, boundary);
  return {
    options: parts.options,
    phases,
    interceptors,
    isHeadless: parts.fields.isHeadless,
    traceStartAfterPhase: boundary,
  };
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
export { buildDescriptor, buildInterceptors, resolveTraceBoundaryPhase };
