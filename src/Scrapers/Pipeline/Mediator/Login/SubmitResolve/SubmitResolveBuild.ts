/**
 * Bundle builders for the LoginSubmitResolve race cluster.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginSubmitResolve.ts}.
 */

import type { SelectorCandidate } from '../../../../Base/Config/LoginConfigTypes.js';
import type { Option } from '../../../Types/Option.js';
import type { IFormAnchor } from '../../Form/FormAnchor.js';
import type { IDiscoverFieldsArgs } from '../LoginFieldDiscovery.types.js';
import { extractFormAnchorSelector } from '../LoginFormAnchor.js';
import type { IFrameScope, IResolveInFrameArgs } from './SubmitResolveTypes.js';

/**
 * Build a resolve-in-frame args bundle for the given candidate list.
 * @param args - Discovery bundle.
 * @param candidates - Candidate list to race.
 * @param scope - Frame scope (frame id + anchor selector).
 * @returns Resolve-in-frame args bundle.
 */
export function buildResolveArgs(
  args: IDiscoverFieldsArgs,
  candidates: readonly SelectorCandidate[],
  scope: IFrameScope,
): IResolveInFrameArgs {
  return { args, candidates, requiredFrameId: scope.frameId, formAnchor: scope.anchor };
}

/**
 * Build the IFrameScope bundle from a form anchor + active frame id.
 * @param formAnchor - Discovered form anchor.
 * @param activeFrameId - Frame where password was found.
 * @returns Frame scope bundle.
 */
export function buildScope(formAnchor: Option<IFormAnchor>, activeFrameId: string): IFrameScope {
  const anchor = extractFormAnchorSelector(formAnchor);
  return { frameId: activeFrameId, anchor };
}
