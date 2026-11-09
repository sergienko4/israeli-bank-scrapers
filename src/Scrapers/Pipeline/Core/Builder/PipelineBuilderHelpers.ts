/**
 * Pipeline builder helpers — descriptor assembly.
 * Extracted from PipelineBuilder.ts to respect max-lines.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IPipelineDescriptor } from '../PipelineDescriptor.js';
import { assemblePhases } from './PipelineAssembly.js';
import {
  type IBuilderFields,
  toBuilderState,
  validateBuilderFields,
} from './PipelineBuilderValidation.js';

/**
 * Construct the pipeline descriptor from validated fields.
 * @param fields - Validated builder fields.
 * @param options - Scraper options.
 * @returns Pipeline descriptor.
 */
function assembleDescriptor(fields: IBuilderFields, options: ScraperOptions): IPipelineDescriptor {
  const state = toBuilderState(fields);
  const phases = assemblePhases(state);
  return { options, phases, isHeadless: fields.isHeadless };
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
  const validation = validateBuilderFields(fields, options);
  if (!validation.success) return validation;
  const descriptor = assembleDescriptor(fields, options);
  return succeed(descriptor);
}

export default buildDescriptor;
