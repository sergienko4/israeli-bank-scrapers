/**
 * Sequential fold helper for LoginFieldDiscovery.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginFieldDiscovery.ts}.
 */

import type { IFieldConfig } from '../../../../Base/Interfaces/Config/FieldConfig.js';
import { none } from '../../../Types/Option.js';
import type { IDiscoverFieldsArgs } from '../LoginFieldDiscovery.types.js';
import { resolveAndAccumulate } from './FieldDiscoveryAccumulate.js';
import type { IFieldAccum } from './FieldDiscoveryTypes.js';

/**
 * Build a single-step reducer that resolves one field on top of the
 * running accumulator promise.
 * @param args - Discovery bundle.
 * @returns Reducer accepted by {@link Array.reduce}.
 */
export function makeFieldStep(
  args: IDiscoverFieldsArgs,
): (acc: Promise<IFieldAccum>, field: IFieldConfig) => Promise<IFieldAccum> {
  return (acc, field) => acc.then(a => resolveAndAccumulate(args, a, field));
}

/**
 * Fold the ordered field list into an {@link IFieldAccum} sequentially.
 * @param args - Discovery bundle.
 * @param ordered - Fields in password-first iteration order.
 * @returns Accumulator after every field has been processed.
 */
export async function foldDiscoveryFields(
  args: IDiscoverFieldsArgs,
  ordered: readonly IFieldConfig[],
): Promise<IFieldAccum> {
  const seed: IFieldAccum = { targets: new Map(), formAnchor: none() };
  const initial: Promise<IFieldAccum> = Promise.resolve(seed);
  const step = makeFieldStep(args);
  return ordered.reduce((acc, field) => step(acc, field), initial);
}
