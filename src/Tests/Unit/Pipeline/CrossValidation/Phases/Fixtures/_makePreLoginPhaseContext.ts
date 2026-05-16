/**
 * Phase H.T3c.3 — fixture-driven IPipelineContext builder for the
 * cross-bank PRE-LOGIN per-phase factory.
 *
 * <p>PRE-LOGIN POST contract (per
 * {@link executeValidateForm} in `PreLoginPhaseActions.ts:254`):
 * succeeds when `mediator.resolveVisible(FORM_GATE)` reports
 * `found=true` (the password input is in the DOM after the bank's
 * reveal click, if any). The helper wires the fixture's
 * {@link IPhaseHExpected.preLoginPostFormGateFound} flag onto the
 * mock mediator's `resolveVisible` surface so the production path
 * reads the captured-shape signal directly.
 *
 * <p>FINAL contract (per {@link executeSignalToLogin}): succeeds
 * when POST committed `loginAreaReady=true`; fails otherwise. The
 * helper's returned context defaults to `loginAreaReady=false` —
 * tests that exercise FINAL after POST chain through the production
 * code path so both transitions are replayed end-to-end.
 *
 * <p>Per `mocking-test-guidlines.md` "Mock external dependencies
 * only" + "Prefer lightweight fakes/stubs".
 */

import type { Page } from 'playwright-core';

import { NOT_FOUND_RESULT } from '../../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
  makeMockMediator,
} from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Result of {@link buildPreLoginPhaseContext} — ready for POST + FINAL replay. */
export interface IPreLoginPhaseTestSubject {
  readonly context: IPipelineContext;
}

/** Bundled arguments for {@link buildPreLoginPhaseContext}. */
export interface IPreLoginPhaseContextArgs {
  readonly isFormGateFound: boolean;
  readonly loginUrl: string;
}

/**
 * Build a PRE-LOGIN-stage test subject from a fixture. Wires the
 * mediator's {@link resolveVisible} to return a fixture-driven
 * `found` result so {@link validateFormGatePost} matches the bank's
 * last-good shape; the mediator's `getCurrentUrl` returns the
 * fixture's login URL so the debug-trace surface matches captured
 * runs.
 *
 * @param args - Bundled arguments (fixture, isFormGateFound, loginUrl).
 * @returns Context ready for PRE-LOGIN.POST + FINAL replay.
 */
export function buildPreLoginPhaseContext(
  args: IPreLoginPhaseContextArgs,
): IPreLoginPhaseTestSubject {
  const { isFormGateFound, loginUrl } = args;
  const page: Page = makeMockFullPage(loginUrl);
  const browserState = makeMockBrowserState(page);
  const browser = some(browserState);
  const foundResult = buildFormGateResult(isFormGateFound);
  const fixtureMediator = makeMockMediator({
    /**
     * Return a fixture-driven race result so PRE-LOGIN.POST's
     * form-gate probe drives off the bank's captured shape.
     * @returns Found race result (per fixture) or NOT_FOUND.
     */
    resolveVisible: (): Promise<typeof NOT_FOUND_RESULT> => Promise.resolve(foundResult),
    /**
     * Return the fixture's login URL so debug logs match captured.
     * @returns Fixture's login URL.
     */
    getCurrentUrl: (): string => loginUrl,
  });
  const mediator = some(fixtureMediator);
  const base = makeMockContext({ browser, mediator });
  return { context: base };
}

/**
 * Build a race result with the requested `found` flag while keeping
 * every other field at the `NOT_FOUND_RESULT` defaults. The PRE-LOGIN
 * POST only checks `.found`, so this single-purpose helper isolates
 * the contract under test from the unrelated locator/identity fields.
 *
 * @param found - True to simulate the password field being visible.
 * @returns Race result with `.found` set per the argument.
 */
function buildFormGateResult(found: boolean): typeof NOT_FOUND_RESULT {
  return { ...NOT_FOUND_RESULT, found };
}
