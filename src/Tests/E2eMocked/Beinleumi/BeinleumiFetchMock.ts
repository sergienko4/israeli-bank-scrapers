/**
 * Beinleumi mocked bank — routes every call to the online origin of the
 * group bank it plays: the portal pages, the Transmit login, the SSO calls and the BFF reads. A
 * call the bank has no route for is noted on the trail and answered 404.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { CallKind, IMockHandle, IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, installFetchMock } from '../Helpers/FetchMockKit.js';
import { BEINLEUMI_MOCK_BRAND } from './BeinleumiBrands.js';
import DATA_ROUTES from './BeinleumiDataRoutes.js';
import type { IBeinleumiMockState, Route } from './BeinleumiFaults.js';
import { PORTAL_ROUTES } from './BeinleumiPortalRoutes.js';
import TRANSMIT_ROUTES from './BeinleumiTransmitRoutes.js';

const LOGIN_ROUTES: Readonly<Record<string, Route>> = { ...PORTAL_ROUTES, ...TRANSMIT_ROUTES };

const ROUTES: Readonly<Partial<Record<string, Route>>> = { ...LOGIN_ROUTES, ...DATA_ROUTES };

/** The mocked bank and the run state its routes keep. */
export interface IBeinleumiMockHandle extends IMockHandle {
  readonly state: IBeinleumiMockState;
}

/**
 * A call's route key: its method and path on the bank's origin.
 * @param origin - The bank's origin.
 * @param call - The request.
 * @returns `<METHOD> <path>`, or '' off the origin.
 */
function keyOf(origin: string, call: IRecordedCall): string {
  const url = new URL(call.url);
  return url.origin === origin ? `${call.method} ${url.pathname}` : '';
}

/**
 * Note a call the bank has no route for.
 * @param call - The request.
 * @param state - Run state.
 * @returns A 404.
 */
function unrouted(call: IRecordedCall, state: IBeinleumiMockState): Response {
  const { origin, pathname } = new URL(call.url);
  state.trail.push(`${call.method} ${origin}${pathname}`);
  return errorReply(404);
}

/**
 * Classify a call to a bank's origin: login calls are identity, BFF reads are data.
 * @param origin - The bank's origin.
 * @param call - The request.
 * @returns The call kind.
 */
function classifyOn(origin: string, call: IRecordedCall): CallKind {
  const key = keyOf(origin, call);
  if (key === '') return 'other';
  return key in LOGIN_ROUTES ? 'identity' : 'graphql';
}

/**
 * Classify a call to Beinleumi.
 * @param call - The request.
 * @returns The call kind.
 */
export function classifyBeinleumi(call: IRecordedCall): CallKind {
  return classifyOn(BEINLEUMI_MOCK_BRAND.origin, call);
}

/**
 * Answer a call through its route.
 * @param state - Run state.
 * @param call - The request.
 * @returns The answer.
 */
function answerBeinleumi(state: IBeinleumiMockState, call: IRecordedCall): Promise<Response> {
  const key = keyOf(state.brand.origin, call);
  const route = ROUTES[key] ?? unrouted;
  const response = route(call, state);
  return Promise.resolve(response);
}

/**
 * Install the mocked bank. Dispose restores fetch.
 * @param state - Run state the routes keep.
 * @returns Handle with the recorded calls and the state.
 */
export function installBeinleumiFetchMock(state: IBeinleumiMockState): IBeinleumiMockHandle {
  const answer = answerBeinleumi.bind(null, state);
  const classify = classifyOn.bind(null, state.brand.origin);
  const handle = installFetchMock({ classify, answer });
  return { ...handle, state };
}
