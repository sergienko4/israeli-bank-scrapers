/**
 * Pipeline descriptor — the output of PipelineBuilder.
 * Contains the ordered list of phases to execute.
 */

import type { ScraperOptions } from '../../Base/Interface.js';
import type { BasePhase } from '../Phases/Base/BasePhase.js';
import type { Procedure } from '../Types/Procedure.js';

/** Descriptor produced by PipelineBuilder, consumed by PipelineExecutor. */
interface IPipelineDescriptor {
  readonly options: ScraperOptions;
  readonly phases: readonly BasePhase[];
}

/**
 * Factory that builds a pipeline descriptor for a specific bank.
 *
 * <p>OCP: this is the only pipeline-registry contract Core declares — it knows
 * NOTHING about concrete banks. The bank -> factory map lives in the Banks
 * layer (`Banks/PipelineRegistry.ts`), so adding a bank touches only
 * `Banks/**`. The `CoreBankIndependence` architecture test enforces that Core
 * carries zero imports of `Banks/**`.
 */
type PipelineFactory = (options: ScraperOptions) => Procedure<IPipelineDescriptor>;

export default IPipelineDescriptor;
export type { IPipelineDescriptor, PipelineFactory };
