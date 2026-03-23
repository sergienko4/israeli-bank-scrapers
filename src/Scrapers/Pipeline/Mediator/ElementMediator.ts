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
import type { INetworkDiscovery } from './NetworkDiscovery.js';

/** High-level element resolution — scrapers describe intent, Mediator resolves. */
interface IElementMediator {
  /**
   * Resolve an input field by credential key.
   * If scopeContext provided: searches ONLY that iframe/frame first (scoped).
   * Falls back to searching all iframes if scoped search fails or no scope.
   * Returns IFieldContext including the frame context where element was found.
   * @param fieldKey - The credential key (e.g., 'username', 'password').
   * @param candidates - Bank-specific selector candidates (can be empty).
   * @param scopeContext - Optional: iframe/frame where a previous field was found.
   */
  resolveField(
    fieldKey: string,
    candidates: readonly SelectorCandidate[],
    scopeContext?: Page | Frame,
    formSelector?: string,
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

  /**
   * Wait for loading indicators to disappear from the given frame.
   * Uses WellKnown loadingIndicator candidates. Retries up to 2 times with 2s delay.
   * Generic — works for any bank after form submit, OTP, or dashboard navigation.
   */
  waitForLoadingDone(frame: Page | Frame): Promise<boolean>;

  /**
   * Resolve a clickable element and click it. Best-effort: returns false if not found.
   * Uses the resolver's text→walk-up-to-interactive-ancestor pipeline.
   * @param candidates - WellKnown selector candidates to try.
   * @param timeoutMs - Optional custom timeout (default: CLICK_RACE_TIMEOUT).
   * @returns True if element was found and clicked, false otherwise.
   */
  resolveAndClick(candidates: readonly SelectorCandidate[], timeoutMs?: number): Promise<boolean>;

  /** Discover and cache the form anchor from a resolved field. */
  discoverForm(resolvedContext: IFieldContext): Promise<Option<IFormAnchor>>;

  /** Scope candidates to the cached form anchor. */
  scopeToForm(candidates: readonly SelectorCandidate[]): readonly SelectorCandidate[];

  /** Network discovery — captures API traffic from browser page. */
  readonly network: INetworkDiscovery;
}

export default IElementMediator;
export type { IElementMediator };
