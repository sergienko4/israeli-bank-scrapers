/**
 * Element Mediator interface — black-box for ALL HTML resolution.
 * Scrapers describe WHAT they want, Mediator finds HOW.
 *
 * The mediator is the SINGLE entry point for all HTML operations:
 * - Fields (inputs, selects): resolveField
 * - Clickables (submit, OTP trigger, links): resolveClickable
 * - Form discovery: discoverForm, scopeToForm
 * - Error detection after submit: discoverErrors
 *
 * Banks NEVER import resolveFieldPipeline, tryInContext, FormErrorDiscovery, etc.
 * LoginSteps NEVER call HTML utilities directly — only through ctx.mediator.
 */

import type { Frame, Page } from 'playwright-core';

import type { IFormAnchor } from '../../../Common/FormAnchor.js';
import type { IFieldContext } from '../../../Common/SelectorResolverPipeline.js';
import type { SelectorCandidate } from '../../Base/Config/LoginConfigTypes.js';
import type { Option } from '../Types/Option.js';
import type { Procedure } from '../Types/Procedure.js';
import type { IFormErrorScanResult } from './FormErrorDiscovery.js';

/** High-level element resolution — scrapers describe intent, Mediator resolves. */
interface IElementMediator {
  /**
   * Resolve an input field by credential key.
   * Searches main page and all child iframes automatically.
   * Returns IFieldContext including the frame context where element was found.
   */
  resolveField(
    fieldKey: string,
    candidates: readonly SelectorCandidate[],
  ): Promise<Procedure<IFieldContext>>;

  /**
   * Resolve a clickable element (submit button, OTP trigger, link).
   * Searches main page and all child iframes automatically.
   * Returns IFieldContext so the caller can click in the correct frame context.
   */
  resolveClickable(candidates: readonly SelectorCandidate[]): Promise<Procedure<IFieldContext>>;

  /**
   * Discover form validation errors in the given frame after submit.
   * Runs Layer 1 (DOM structural scan) then Layer 2 (WellKnown text) if needed.
   * Pass the activeFrame so iframe forms (e.g. VisaCal connect) are scanned correctly.
   */
  discoverErrors(frame: Page | Frame): Promise<IFormErrorScanResult>;

  /** Discover and cache the form anchor from a resolved field. */
  discoverForm(resolvedContext: IFieldContext): Promise<Option<IFormAnchor>>;

  /** Scope candidates to the cached form anchor. */
  scopeToForm(candidates: readonly SelectorCandidate[]): readonly SelectorCandidate[];
}

export default IElementMediator;
export type { IElementMediator };
