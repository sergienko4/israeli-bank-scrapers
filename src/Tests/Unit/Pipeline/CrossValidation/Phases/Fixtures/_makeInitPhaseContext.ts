/**
 * Phase H.T3c.1 — fixture-driven IPipelineContext builder for the
 * cross-bank INIT per-phase factory.
 *
 * <p>INIT POST contract (per `InitActions.ts:129-145`): succeeds
 * when `input.browser.has` AND `page.url() !== 'about:blank'` AND
 * Firefox-neterror probe reports `isNeterror=false`. The helper
 * wires a mock page whose `url()` returns the fixture's
 * post-goto URL so the contract drives off bank-shape data.
 */

import type { Page } from 'playwright-core';

import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
} from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Result of {@link buildInitPhaseContext} — POST replay-ready. */
export interface IInitPhaseTestSubject {
  readonly context: IPipelineContext;
}

/** Bundled arguments for {@link buildInitPhaseContext}. */
export interface IInitPhaseContextArgs {
  readonly initPostUrl: string;
}

/**
 * Build an INIT-stage test subject from a fixture. Wires a mock
 * browser whose page.url() returns the fixture's post-goto URL so
 * INIT.POST's `currentUrl === 'about:blank'` check + Firefox
 * neterror probe drive off captured-shape data.
 *
 * @param args - Bundled arguments (initPostUrl).
 * @returns Context ready for INIT.POST replay.
 */
export function buildInitPhaseContext(args: IInitPhaseContextArgs): IInitPhaseTestSubject {
  const { initPostUrl } = args;
  const page: Page = makeMockFullPage(initPostUrl);
  const browserState = makeMockBrowserState(page);
  const browser = some(browserState);
  const base = makeMockContext({ browser });
  return { context: base };
}
