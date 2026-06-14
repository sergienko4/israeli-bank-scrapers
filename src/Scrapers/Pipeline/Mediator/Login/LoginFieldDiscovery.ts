/**
 * LOGIN field-discovery facade. Thin orchestrator over the
 * FieldDiscovery/ sub-modules.
 *
 * <p>Phase 12d split: see
 * FieldDiscovery/{FieldDiscoveryTypes,FieldDiscoveryResolveOne,
 * FieldDiscoveryAccumulate,FieldDiscoveryFold}.ts for the
 * implementations.
 */

import type { ILoginFieldDiscovery } from '../../Types/PipelineContext.js';
import { computeContextId } from '../Elements/ActionExecutors.js';
import { passwordFirst } from '../Form/LoginScopeResolver.js';
import { foldDiscoveryFields } from './FieldDiscovery/FieldDiscoveryFold.js';
import type { IFieldAccum } from './FieldDiscovery/FieldDiscoveryTypes.js';
import type { IDiscoverFieldsArgs } from './LoginFieldDiscovery.types.js';
import { resolveSubmitTarget } from './LoginSubmitResolve.js';

/**
 * Select the active-frame id for downstream submit resolution.
 * @param args - Discovery bundle.
 * @param final - Final field-resolution accumulator.
 * @returns Frame id where the submit button must live.
 */
function pickActiveFrameId(args: IDiscoverFieldsArgs, final: IFieldAccum): string {
  const fallback = computeContextId(args.activeFrame, args.page);
  const passwordTarget = final.targets.get('password');
  return passwordTarget?.contextId ?? fallback;
}

/**
 * Discover all login fields via mediator and build ILoginFieldDiscovery.
 * @param args - Bundled discovery arguments.
 * @returns Fully populated login field discovery.
 */
async function executeDiscoverFields(args: IDiscoverFieldsArgs): Promise<ILoginFieldDiscovery> {
  const ordered = passwordFirst(args.config.fields);
  const final = await foldDiscoveryFields(args, ordered);
  const activeFrameId = pickActiveFrameId(args, final);
  const submitTarget = await resolveSubmitTarget(args, final.formAnchor, activeFrameId);
  return { targets: final.targets, formAnchor: final.formAnchor, activeFrameId, submitTarget };
}

export type { IDiscoverFieldsArgs };
export { executeDiscoverFields };
