/**
 * Pipeline builder helpers — descriptor assembly.
 * Extracted from PipelineBuilder.ts to respect max-lines.
 */

import type { ScraperOptions } from '../../../Base/Interface.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { ICredentialPolicy, IPipelineDescriptor } from '../PipelineDescriptor.js';
import { assemblePhases } from './PipelineAssembly.js';
import {
  type IBuilderFields,
  toBuilderState,
  validateBuilderFields,
} from './PipelineBuilderValidation.js';

/**
 * The bank's required-credential policy, when it declares one.
 * @param fields - Validated builder fields.
 * @returns The policy, or false when the bank has no call config.
 */
function credentialPolicyOf(fields: IBuilderFields): ICredentialPolicy | false {
  if (fields.apiDirectConfig === false) return false;
  return { requiredCreds: fields.apiDirectConfig.requiredCreds };
}

/**
 * Assemble the descriptor's options, phases and credential policy.
 * @param fields - Validated builder fields.
 * @param options - Scraper options.
 * @returns Pipeline descriptor without the enricher.
 */
function baseDescriptor(fields: IBuilderFields, options: ScraperOptions): IPipelineDescriptor {
  const state = toBuilderState(fields);
  const phases = assemblePhases(state);
  const policy = credentialPolicyOf(fields);
  if (policy === false) return { options, phases };
  return { options, phases, credentialPolicy: policy };
}

/**
 * Construct the pipeline descriptor from validated fields.
 * @param fields - Validated builder fields.
 * @param options - Scraper options.
 * @returns Pipeline descriptor.
 */
function assembleDescriptor(fields: IBuilderFields, options: ScraperOptions): IPipelineDescriptor {
  const descriptor = baseDescriptor(fields, options);
  if (fields.enrichCredentials === undefined) return descriptor;
  return { ...descriptor, enrichCredentials: fields.enrichCredentials };
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
