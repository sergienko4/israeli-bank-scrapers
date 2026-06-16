/**
 * Low-level credential field fill — resolves one field via the element
 * mediator and fills it. Extracted from LoginFormFill.ts so it has no
 * back-edge to LoginFormFill/LoginScopeResolver, breaking their cycle.
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../Base/Config/LoginConfigTypes.js';
import type { ScraperLogger } from '../../Types/Debug.js';
import { maskVisibleText } from '../../Types/LogEvent.js';
import type { Procedure } from '../../Types/Procedure.js';
import { succeed } from '../../Types/Procedure.js';
import type { IElementMediator } from '../Elements/ElementMediator.js';
import { deepFillInput } from '../Elements/ElementsInteractions.js';
import type { IFieldContext } from '../Selector/SelectorResolverPipeline.js';

/** Options for filling a single credential field. */
export interface IFillOpts {
  readonly credentialKey: string;
  readonly value: string;
  readonly selectors: readonly SelectorCandidate[];
}

/** Bundled options for filling one field via mediator. */
export interface IFillFieldOpts {
  readonly mediator: IElementMediator;
  readonly fill: IFillOpts;
  readonly scopeContext?: Page | Frame;
  readonly formSelector?: string;
  readonly logger: ScraperLogger;
}

/** Result of filling one field. */
export interface IFillResult {
  readonly isOk: boolean;
  readonly procedure: Procedure<boolean>;
  readonly resolvedContext?: Page | Frame;
}

/** Lookup for resolve outcome labels. */
const RESOLVE_STATUS: Record<string, string> = { true: 'FOUND', false: 'NOT_FOUND' };

/**
 * Log field resolution intent and outcome.
 * @param log - Logger instance.
 * @param key - Credential key name.
 * @param success - Whether resolution succeeded.
 * @returns The success flag for chaining.
 */
function logResolveResult(log: ScraperLogger, key: string, success: boolean): boolean {
  const status = RESOLVE_STATUS[String(success)];
  log.debug({ field: maskVisibleText(key), result: status });
  return success;
}

/**
 * Resolve a credential field via mediator, logging the outcome.
 * @param opts - Bundled fill options.
 * @returns Resolve result from the mediator.
 */
async function resolveCredentialField(opts: IFillFieldOpts): Promise<Procedure<IFieldContext>> {
  const key = opts.fill.credentialKey;
  opts.logger.debug({ message: `resolving ${maskVisibleText(key)}` });
  const result = await opts.mediator.resolveField(
    key,
    opts.fill.selectors,
    opts.scopeContext,
    opts.formSelector,
  );
  logResolveResult(opts.logger, key, result.success);
  return result;
}

/**
 * Fill one credential field via mediator.
 * @param opts - Bundled fill options.
 * @returns Fill result with resolved context.
 */
export async function fillOneField(opts: IFillFieldOpts): Promise<IFillResult> {
  const result = await resolveCredentialField(opts);
  if (!result.success) return { isOk: false, procedure: result };
  await deepFillInput(result.value.context, result.value.selector, opts.fill.value);
  return { isOk: true, procedure: succeed(true), resolvedContext: result.value.context };
}
