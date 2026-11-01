/**
 * Yahav mocked bank — routes every call to the synthetic native origin, and
 * routes the mTLS transport through the mocked fetch so each route sees the
 * certificate its request presents.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { MtlsFallback } from '../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import { setMtlsFetchFallback } from '../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsTransport.js';
import { invokeFetch } from '../../../Scrapers/Pipeline/Strategy/Fetch/NativeFetchStrategy.js';
import type { CallKind, IMockHandle, IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, installFetchMock } from '../Helpers/FetchMockKit.js';
import { AUTH_ROUTES } from './YahavAuthRoutes.js';
import { BANCS_ROUTES } from './YahavBancsRoutes.js';
import type { IYahavMockState, Route } from './YahavFaults.js';
import { YH_ORIGIN } from './YahavMockData.js';

const ROUTES: Readonly<Partial<Record<string, Route>>> = { ...AUTH_ROUTES, ...BANCS_ROUTES };

/** The mocked bank and the run state its routes keep. */
export interface IYahavMockHandle extends IMockHandle {
  readonly state: IYahavMockState;
}

/**
 * The route a call reaches.
 * @param call - The request.
 * @returns Its route, or a 404 for anything off the native origin's paths.
 */
function routeOf(call: IRecordedCall): Route {
  const { origin, pathname } = new URL(call.url);
  const route = origin === YH_ORIGIN ? ROUTES[`${call.method} ${pathname}`] : undefined;
  return route ?? ((): Response => errorReply(404));
}

/**
 * Classify a call: login calls are identity, BaNCS calls are data.
 * @param call - The request.
 * @returns The call kind.
 */
export function classifyYahav(call: IRecordedCall): CallKind {
  const { origin, pathname } = new URL(call.url);
  if (origin !== YH_ORIGIN) return 'other';
  return pathname.startsWith('/BaNCSDigitalApp/') ? 'graphql' : 'identity';
}

/**
 * Answer a call through its route.
 * @param state - Run state.
 * @param call - The request.
 * @returns The answer.
 */
function answerYahav(state: IYahavMockState, call: IRecordedCall): Promise<Response> {
  const response = routeOf(call)(call, state);
  return Promise.resolve(response);
}

/**
 * The mTLS transport, mocked: note what the request presents, then fetch.
 * The mocked fetch answers synchronously, so the route reads this request's
 * certificate before any other request can replace it.
 * @param state - Run state; its presented certificate is replaced.
 * @returns The fallback transport.
 */
function viaMockedFetch(state: IYahavMockState): MtlsFallback {
  return request => {
    state.presented = request.presented;
    state.presentedLog.push(request.presented);
    return invokeFetch(request.url, request.init, request.verb);
  };
}

/**
 * Install the mocked bank. Dispose restores fetch and the mTLS transport.
 * @param state - Run state the routes keep.
 * @returns Handle with the recorded calls and the state.
 */
export function installYahavFetchMock(state: IYahavMockState): IYahavMockHandle {
  const answer = answerYahav.bind(null, state);
  const handle = installFetchMock({ classify: classifyYahav, answer });
  const presentingFetch = viaMockedFetch(state);
  setMtlsFetchFallback(presentingFetch);
  /**
   * Restore fetch and the node:https transport.
   * @returns True once both are restored.
   */
  const dispose = (): boolean => handle.dispose() && !setMtlsFetchFallback();
  return { ...handle, dispose, state };
}
