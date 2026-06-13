/**
 * Types + constants for the LoginFieldDiscovery fold pipeline.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginFieldDiscovery.ts}.
 */

import type { IFieldConfig } from '../../../../Base/Interfaces/Config/FieldConfig.js';
import type { Option } from '../../../Types/Option.js';
import type {
  ILoginFieldDiscovery,
  IPipelineContext,
  IResolvedTarget,
  LoginFieldKey,
} from '../../../Types/PipelineContext.js';
import type { IFormAnchor } from '../../Form/FormAnchor.js';
import type { IDiscoverFieldsArgs } from '../LoginFieldDiscovery.types.js';

/** Re-export to keep the public `ILoginFieldDiscovery` reachable from sub-modules. */
export type { ILoginFieldDiscovery };

/** Accumulator for the field-discovery reduce. */
export interface IFieldAccum {
  readonly targets: Map<LoginFieldKey, IResolvedTarget>;
  readonly formAnchor: Option<IFormAnchor>;
}

/** Bundle for {@link resolveOneField} — keeps the body under the 10-line ceiling. */
export interface IResolveOneArgs {
  readonly args: IDiscoverFieldsArgs;
  readonly field: IFieldConfig;
  readonly anchor: Option<IFormAnchor>;
}

/** Bundle for {@link accumulateField} — under the 3-param ceiling. */
export interface IAccumulateCallArgs {
  readonly accum: IFieldAccum;
  readonly field: IFieldConfig;
  readonly resolved: IResolvedTarget | false;
  readonly logger: IPipelineContext['logger'];
}

/** Bundle for {@link maybeDiscoverAnchor}. */
export interface IAnchorCheckArgs {
  readonly accum: IFieldAccum;
  readonly field: IFieldConfig;
  readonly resolved: IResolvedTarget | false;
}

/** Lookup for field resolution trace labels. */
export const FIELD_RESULT_TAG: Record<string, string> = { true: 'FOUND', false: 'NOT_FOUND' };
