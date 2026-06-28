/**
 * Shared types + helpers for login-form action paths.
 *
 * <p>Phase 12d split: extracted from {@link ../LoginFormActions.ts}.
 * Common surface used by both the classic fill path (ActionsFill.ts)
 * and the discovery-based fill path (ActionsDiscovery.ts).
 */

import type { Frame, Page } from 'playwright-core';

import type { SelectorCandidate } from '../../../../Base/Config/LoginConfigTypes.js';
import { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { ILoginConfig } from '../../../../Base/Interfaces/Config/LoginConfig.js';
import type { ScraperLogger } from '../../../Types/Debug.js';
import { maskVisibleText } from '../../../Types/LogEvent.js';
import type { ILoginFieldDiscovery } from '../../../Types/PipelineContext.js';
import type { Procedure } from '../../../Types/Procedure.js';
import { fail, succeed } from '../../../Types/Procedure.js';
import type { IActionMediator, IElementMediator } from '../../Elements/ElementMediator.js';

/** Fill result with resolved frame scope. */
export interface IFillAllResult {
  readonly procedure: Procedure<boolean>;
  readonly frameContext: Page | Frame | undefined;
}

/** How the login form was submitted. */
export type SubmitMethod = 'enter' | 'click' | 'both';

/** Result of fillAndSubmit — includes which submit method fired. */
export interface ISubmitResult {
  readonly success: boolean;
  readonly method: SubmitMethod;
}

/** Bundled args for filling all credential fields. */
export interface IFillAllArgs {
  readonly mediator: IElementMediator;
  readonly fields: ILoginConfig['fields'];
  readonly creds: Record<string, string>;
  readonly logger: ScraperLogger;
}

/** Bundled args for fill-and-submit. */
export interface IFillAndSubmitArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly creds: Record<string, string>;
  readonly logger: ScraperLogger;
}

/** Result bundle returned by `runSubmitPhase` / `submitViaDiscovery`. */
export interface ISubmitPhaseResult {
  readonly didEnter: boolean;
  readonly clickResult: Procedure<boolean>;
}

/** Bundled args for `runSubmitPhase` — fits the 3-param ceiling. */
export interface ISubmitPhaseArgs {
  readonly mediator: IElementMediator;
  readonly config: ILoginConfig;
  readonly enterCtx: Page | Frame | false;
  readonly logger: ScraperLogger;
}

/** Bundled args for filling from PRE-resolved discovery via sealed executor. */
export interface IFillFromDiscoveryArgs {
  readonly discovery: ILoginFieldDiscovery;
  readonly executor: IActionMediator;
  readonly config: ILoginConfig;
  readonly creds: Record<string, string>;
  readonly logger: ScraperLogger;
}

/**
 * Normalize submit config to array. Empty = [] (mediator handles WK fallback).
 * @param submit - Single or array of candidates.
 * @returns Array of candidates.
 */
export function normalizeSubmit(submit: ILoginConfig['submit']): readonly SelectorCandidate[] {
  if (Array.isArray(submit)) return submit;
  return [submit];
}

/** Submit method lookup: [didEnter][didClick] → method. */
const SUBMIT_METHOD_MAP: Record<string, SubmitMethod> = {
  'true-true': 'both',
  'true-false': 'enter',
  'false-true': 'click',
  'false-false': 'click',
};

/**
 * Resolve which submit method was used from boolean flags.
 * @param didEnter - Whether Enter was pressed.
 * @param didClick - Whether submit button was clicked.
 * @returns The submit method used.
 */
export function resolveSubmitMethod(didEnter: boolean, didClick: boolean): SubmitMethod {
  const key = `${String(didEnter)}-${String(didClick)}`;
  return SUBMIT_METHOD_MAP[key];
}

/**
 * Convert a submit-phase bundle into the final method label.
 * @param submit - Result bundle from `runSubmitPhase`.
 * @returns The submit method that fired (enter / click / both).
 */
export function resolveSubmitFromPhase(submit: ISubmitPhaseResult): SubmitMethod {
  const didClick = submit.clickResult.success && submit.clickResult.value;
  return resolveSubmitMethod(submit.didEnter, didClick);
}

/**
 * Detect whether any submit signal actually fired in the discovery path.
 * @param submit - Submit-phase bundle.
 * @returns True when Enter fired OR click resolved with value=true.
 */
function didAnySubmitFire(submit: ISubmitPhaseResult): boolean {
  const didClick = submit.clickResult.success && submit.clickResult.value;
  return submit.didEnter || didClick;
}

/**
 * Gate the no-submit-signal branch — returns a failure when neither
 * Enter nor Click fired (phantom-success guard).
 * @param submit - Submit-phase bundle.
 * @returns succeed(true) when at least one signal fired; failure otherwise.
 */
export function gateNoSubmitSignal(submit: ISubmitPhaseResult): Procedure<true> {
  if (didAnySubmitFire(submit)) return succeed(true);
  return fail(ScraperErrorTypes.Generic, 'No submit signal fired (Enter and click both absent)');
}

/**
 * Emit a structured "fill" debug line carrying the field count.
 * @param logger - Pipeline logger.
 * @param count - Number of fields about to be filled.
 * @returns True after emit (callers discard).
 */
export function logFillCount(logger: ScraperLogger, count: number): true {
  logger.debug({ event: 'login.form.fill', fieldCount: count });
  return true;
}

/**
 * Emit the post-submit debug line (method + masked current URL).
 * @param logger - Pipeline logger.
 * @param source - Anything that exposes `getCurrentUrl()` (mediator or executor).
 * @param source.getCurrentUrl - URL provider function on the source.
 * @param method - Submit method that fired (enter / click / both).
 * @returns True after emit (callers discard).
 */
export function logSubmitResult(
  logger: ScraperLogger,
  source: { readonly getCurrentUrl: () => string },
  method: SubmitMethod,
): true {
  const url = source.getCurrentUrl();
  const masked = maskVisibleText(url);
  logger.debug({ event: 'login.submit', method, url: masked });
  return true;
}
