/**
 * LOGIN submit-target resolution — race-based search scoped to the
 * password frame + form anchor (facade).
 *
 * <p>Phase 12d split: implementation moved to {@link ./SubmitResolve/}.
 * This file is a thin facade that composes the sub-modules and
 * preserves the public surface (default + named export).
 */

import type { Option } from '../../Types/Option.js';
import type { IResolvedTarget } from '../../Types/PipelineContext.js';
import type { IFormAnchor } from '../Form/FormAnchor.js';
import type { IDiscoverFieldsArgs } from './LoginFieldDiscovery.types.js';
import { buildScope } from './SubmitResolve/SubmitResolveBuild.js';
import { tryConfiguredSubmit, tryStructuralSubmit } from './SubmitResolve/SubmitResolveCore.js';

/**
 * Resolve the submit button — ONE form, ONE button.
 * @param args - Discovery bundle.
 * @param formAnchor - Discovered form anchor.
 * @param activeFrameId - Frame where password was found.
 * @returns Option wrapping the resolved submit target.
 */
async function resolveSubmitTarget(
  args: IDiscoverFieldsArgs,
  formAnchor: Option<IFormAnchor>,
  activeFrameId: string,
): Promise<Option<IResolvedTarget>> {
  const scope = buildScope(formAnchor, activeFrameId);
  const structural = await tryStructuralSubmit(args, scope);
  if (structural.has) return structural;
  return tryConfiguredSubmit(args, scope);
}

export default resolveSubmitTarget;
export { resolveSubmitTarget };
