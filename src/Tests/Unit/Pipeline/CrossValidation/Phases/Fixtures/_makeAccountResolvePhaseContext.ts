/**
 * Phase H.T3c.8 — fixture-driven IPipelineContext builder for the
 * cross-bank ACCOUNT-RESOLVE per-phase factory.
 *
 * <p>POST contract (per `AccountResolveActions.ts:249-278`): reads
 * `mediator.network.getPreNavCaptures()`, runs
 * `discoverAccountsInPool`, fails loud on empty ids or
 * count-vs-container mismatch, otherwise commits
 * `ctx.accountDiscovery`. FINAL is telemetry-only and always
 * succeeds.
 *
 * <p>The helper builds a captured-shape pre-nav pool from the
 * fixture's redacted accounts payload so the production
 * `pickAccountEndpoint` + `extractAccountIds` chain runs against
 * the bank's actual response shape — Hapoalim's `cards` array,
 * beinleumi's `bankAccountNumber` aliases, Discount's
 * `accountIds`, etc.
 */

import type { Page } from 'playwright-core';

import type { IDiscoveredEndpoint } from '../../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { some } from '../../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  makeMockBrowserState,
  makeMockContext,
  makeMockFullPage,
  makeMockMediator,
} from '../../../../Scrapers/Pipeline/MockPipelineFactories.js';

/** Result of {@link buildAccountResolvePhaseContext} — POST+FINAL replay-ready. */
export interface IAccountResolvePhaseTestSubject {
  readonly context: IPipelineContext;
}

/** Bundled arguments for {@link buildAccountResolvePhaseContext}. */
export interface IAccountResolvePhaseContextArgs {
  readonly poolUrl: string;
  readonly responseBody: unknown;
}

/** Empty headers map reused across synthesised endpoints. */
const EMPTY_HEADERS: Readonly<Record<string, string>> = {};

/**
 * Build an ACCOUNT-RESOLVE-stage test subject from a fixture. Wires
 * the mediator's `network.getPreNavCaptures` to return a single
 * synthesised endpoint whose responseBody matches the bank's
 * captured-shape accounts payload — driving `discoverAccountsInPool`
 * end-to-end against real-shape data.
 *
 * @param args - Bundled arguments (poolUrl, responseBody).
 * @returns Context ready for ACCOUNT-RESOLVE.POST + FINAL replay.
 */
export function buildAccountResolvePhaseContext(
  args: IAccountResolvePhaseContextArgs,
): IAccountResolvePhaseTestSubject {
  const { poolUrl, responseBody } = args;
  const page: Page = makeMockFullPage(poolUrl);
  const browserState = makeMockBrowserState(page);
  const browser = some(browserState);
  const accountsEndpoint = buildAccountsEndpoint(poolUrl, responseBody);
  const preNavPool: readonly IDiscoveredEndpoint[] = [accountsEndpoint];
  const baseMediator = makeMockMediator();
  const fixtureMediator = {
    ...baseMediator,
    network: {
      ...baseMediator.network,
      /**
       * Return the fixture's pre-nav pool so ACCOUNT-RESOLVE.POST
       * runs `discoverAccountsInPool` against bank-shape data.
       * @returns Single-element synthesised pool.
       */
      getPreNavCaptures: (): readonly IDiscoveredEndpoint[] => preNavPool,
    },
  };
  const mediator = some(fixtureMediator);
  const base = makeMockContext({ browser, mediator });
  return { context: base };
}

/**
 * Build a single discovered-endpoint record from the fixture's
 * accounts URL + redacted body. Synthesises content-type, headers,
 * timestamps deterministically so the frozen pool is
 * indistinguishable from a real capture for `discoverAccountsInPool`.
 *
 * @param url - Accounts endpoint URL on `.example` reserved TLD.
 * @param body - Redacted accounts payload.
 * @returns Discovered endpoint record.
 */
function buildAccountsEndpoint(url: string, body: unknown): IDiscoveredEndpoint {
  return {
    url,
    method: 'GET',
    postData: '',
    status: 200,
    responseBody: body,
    contentType: 'application/json',
    requestHeaders: EMPTY_HEADERS,
    responseHeaders: EMPTY_HEADERS,
    timestamp: 0,
    captureIndex: 0,
  };
}
