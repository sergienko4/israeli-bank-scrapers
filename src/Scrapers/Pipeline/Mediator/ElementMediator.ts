/**
 * Element Mediator interface — black-box for HTML element resolution.
 * Scrapers describe WHAT they want, Mediator finds HOW.
 * Wraps SelectorResolver + FormAnchor + WellKnownSelectors.
 */

import type { IFormAnchor } from '../../../Common/FormAnchor.js';
import type { IFieldContext } from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import type { Option } from '../Types/Option.js';
import type { Procedure } from '../Types/Procedure.js';

/** High-level element resolution — scrapers describe intent, Mediator resolves. */
interface IElementMediator {
  /** Resolve an input field by credential key. */
  resolveField(
    fieldKey: string,
    candidates: readonly SelectorCandidate[],
  ): Promise<Procedure<IFieldContext>>;

  /** Resolve a clickable element (submit button, OTP trigger). */
  resolveClickable(candidates: readonly SelectorCandidate[]): Promise<Procedure<string>>;

  /** Discover and cache the form anchor from a resolved field. */
  discoverForm(resolvedContext: IFieldContext): Promise<Option<IFormAnchor>>;

  /** Scope candidates to the cached form anchor. */
  scopeToForm(candidates: readonly SelectorCandidate[]): readonly SelectorCandidate[];
}

export default IElementMediator;
export type { IElementMediator };
