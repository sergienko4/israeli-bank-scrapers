/**
 * Pipeline builder helpers — build logic and interceptor assembly.
 * Extracted from PipelineBuilder.ts to respect max-lines.
 */

import type { ScraperOptions } from '../../Base/Interface.js';
import { createPopupInterceptor } from '../Interceptors/PopupInterceptor.js';
import type { IPipelineInterceptor } from '../Types/Interceptor.js';
import type { Procedure } from '../Types/Procedure.js';
import { succeed } from '../Types/Procedure.js';
import { assemblePhases } from './BuilderAssembly.js';
import {
  assertRequiredFields,
  type IBuilderFields,
  type ScrapeFn,
  toBuilderState,
} from './PipelineBuilderValidation.js';
import type { IPipelineDescriptor } from './PipelineDescriptor.js';

/**
 * Build interceptors based on browser flag.
 * @param hasBrowser - Whether browser lifecycle is enabled.
 * @returns Interceptor array.
 */
function buildInterceptors(hasBrowser: boolean): readonly IPipelineInterceptor[] {
  if (!hasBrowser) return [];
  return [createPopupInterceptor()];
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
  const validation = assertRequiredFields(fields);
  if (!validation.success) return validation;
  const state = toBuilderState(fields);
  const phases = assemblePhases(state);
  const interceptors = buildInterceptors(fields.hasBrowser);
  return succeed({ options, phases, interceptors });
}

export type { ScrapeFn };
export { buildDescriptor, buildInterceptors };
