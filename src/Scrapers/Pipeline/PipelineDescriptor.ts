/**
 * Pipeline descriptor — the output of PipelineBuilder.
 * Contains the ordered list of phases to execute.
 */

import type { ScraperOptions } from '../Base/Interface.js';
import type { IPhaseDefinition } from './Types/Phase.js';
import type { IPipelineContext } from './Types/PipelineContext.js';

/** Descriptor produced by PipelineBuilder, consumed by PipelineExecutor. */
interface IPipelineDescriptor {
  readonly options: ScraperOptions;
  readonly phases: readonly IPhaseDefinition<IPipelineContext, IPipelineContext>[];
}

export default IPipelineDescriptor;
export type { IPipelineDescriptor };
