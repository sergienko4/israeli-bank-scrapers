/**
 * Beinleumi mocked bank — routes every call to the synthetic online origin:
 * the portal pages, the Transmit login, the SSO calls and the BFF reads. A
 * call the bank has no route for is noted on the trail and answered 404.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { CallKind, IMockHandle, IRecordedCall } from '../Helpers/FetchMockKit.js';
import { errorReply, installFetchMock } from '../Helpers/FetchMockKit.js';
import DATA_ROUTES from './BeinleumiDataRoutes.js';
import type { IBeinleumiMockState, Route } from './BeinleumiFaults.js';
import { PORTAL_ROUTES } from './BeinleumiPortalRoutes.js';
import TRANSMIT_ROUTES from './BeinleumiTransmitRoutes.js';
import { BN_ORIGIN } from './BeinleumiWireSpec.js';

const LOGIN_ROUTES: Readonly<Record<string, Route>> = { ...PORTAL_ROUTES, ...TRANSMIT_ROUTES };

const ROUTES: Readonly<Partial<Record<string, Route>>> = { ...LOGIN_ROUTES, ...DATA_ROUTES };

/** The mocked bank and the run state its routes keep. */
export interface IBeinleumiMockHandle extends IMockHandle {
  readonly state: IBeinleumiMockState;
}

/**
 * A call's route key: its method and path on the bank's origin.
 * @param call - The request.
 * @returns `<METHOD> <path>`, or '' off the origin.
 */
function keyOf(call: IRecordedCall): string {
  const { origin, pathname } = new URL(call.url);
  return origin === BN_ORIGIN ? `${call.method} ${pathname}` : '';
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
 * Classify a call: login calls are identity, BFF reads are data.
 * @param call - The request.
 * @returns The call kind.
 */
export function classifyBeinleumi(call: IRecordedCall): CallKind {
  const key = keyOf(call);
  if (key === '') return 'other';
  return key in LOGIN_ROUTES ? 'identity' : 'graphql';
}

/**
 * Answer a call through its route.
 * @param state - Run state.
 * @param call - The request.
 * @returns The answer.
 */
function answerBeinleumi(state: IBeinleumiMockState, call: IRecordedCall): Promise<Response> {
  const key = keyOf(call);
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
  const handle = installFetchMock({ classify: classifyBeinleumi, answer });
  return { ...handle, state };
}
