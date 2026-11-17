/**
 * Shared test factory for the `IDispatchBundle` the extract-rule pass reads.
 * Keeping the bundle wiring in one place lets config suites vary only the step,
 * scope, bank and URL under test.
 */

import type { CompanyTypes } from '../../Definitions.js';
import type { IStepConfig } from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { IDispatchBundle } from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.types.js';
import type { ITemplateScope } from '../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';

/** Inputs for one dispatch-bundle fixture. */
interface IDispatchBundleParts {
  readonly step: IStepConfig;
  readonly scope: ITemplateScope;
  readonly companyId: CompanyTypes;
  readonly url: IDispatchBundle['target'];
  readonly bus: IDispatchBundle['fireScope']['bus'];
}

/**
 * Build the bundle a `ruleStepCarry` call expects.
 * @param parts - Step, scope, bank, URL and stub mediator.
 * @returns A dispatch bundle with the shared wiring populated.
 */
export default function makeDispatchBundle(parts: IDispatchBundleParts): IDispatchBundle {
  const { step, scope, companyId, url, bus } = parts;
  return {
    fireArgs: { body: {}, query: {}, extraHeaders: {} },
    fireScope: { step: { ...step, urlTag: url }, bus, scope, companyId },
    baseCtx: { stepName: step.name, urlTag: step.urlTag, bodyKeyCount: 0, extractKeys: [] },
    preparedScope: scope,
    target: url,
  };
}
