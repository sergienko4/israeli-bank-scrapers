/**
 * Types + WK constants for the LoginSubmitResolve race cluster.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginSubmitResolve.ts}.
 */

import type { SelectorCandidate } from '../../../../Base/Config/LoginConfigTypes.js';
import { WK_LOGIN_FORM } from '../../../Registry/WK/LoginWK.js';
import type { IPipelineContext } from '../../../Types/PipelineContext.js';
import type { IDiscoverFieldsArgs } from '../LoginFieldDiscovery.types.js';

/** Bundled args for resolveInFrame — under the 3-param ceiling. */
export interface IResolveInFrameArgs {
  readonly args: IDiscoverFieldsArgs;
  readonly candidates: readonly SelectorCandidate[];
  readonly requiredFrameId: string;
  readonly formAnchor: string;
}

/** Bundled state captured once per submit-resolution race. */
export interface IFrameMatchArgs {
  readonly logger: IPipelineContext['logger'];
  readonly candidateVal: string;
  readonly contextId: string;
  readonly kind: string;
  readonly requiredFrameId: string;
}

/** Frame scope bundle (frame id + form anchor selector). */
export interface IFrameScope {
  readonly frameId: string;
  readonly anchor: string;
}

/** WK structural submit candidates. */
export const STRUCTURAL_SUBMIT_WK =
  WK_LOGIN_FORM.submitStructural as unknown as readonly SelectorCandidate[];
