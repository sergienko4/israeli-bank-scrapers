/**
 * Pipeline descriptor — the output of PipelineBuilder.
 * Contains the ordered list of phases to execute.
 */

import type { ScraperOptions } from '../Base/Interface.js';
import type { BasePhase } from './Types/BasePhase.js';
import type { IPipelineInterceptor } from './Types/Interceptor.js';

/** Descriptor produced by PipelineBuilder, consumed by PipelineExecutor. */
interface IPipelineDescriptor {
  readonly options: ScraperOptions;
  readonly phases: readonly BasePhase[];
  readonly interceptors: readonly IPipelineInterceptor[];
}

export default IPipelineDescriptor;
export type { IPipelineDescriptor };
