/**
 * Hapoalim synthetic fetch mock — stands in for the bank's one origin so the
 * HTTP-only login and scrape run with no network. The routes live in
 * HapoalimAuthRoutes (login, `identity`) and HapoalimDataRoutes (`graphql`).
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type {
  CallKind,
  IMockHandle,
  IRecordedCall,
  NetworkFault,
} from '../Helpers/FetchMockKit.js';
import { errorReply, installFetchMock, NETWORK_FAULTS } from '../Helpers/FetchMockKit.js';
import { AUTH_ROUTES, HP_FIRST_PATH } from './HapoalimAuthRoutes.js';
import { DATA_ROUTES, HP_DATA_PATHS } from './HapoalimDataRoutes.js';
import type { HapoalimFault, IMockRun, Route } from './HapoalimFaults.js';
import { HP_ORIGIN } from './HapoalimMockData.js';

const ROUTES: Readonly<Partial<Record<string, Route>>> = { ...AUTH_ROUTES, ...DATA_ROUTES };

const DATA_PATH_SET: ReadonlySet<string> = new Set(Object.values(HP_DATA_PATHS));

/**
 * The route a call reaches.
 * @param call - The recorded request.
 * @returns The route, or a 404 for anything off the bank's map.
 */
function routeOf(call: IRecordedCall): Route {
  const { origin, pathname } = new URL(call.url);
  const route = origin === HP_ORIGIN ? ROUTES[`${call.method} ${pathname}`] : undefined;
  return route ?? ((): Response => errorReply(404));
}

/**
 * Count login calls apart from data calls.
 * @param call - The recorded request.
 * @returns `graphql` for a data call, `identity` for a login call.
 */
export function classifyHapoalim(call: IRecordedCall): CallKind {
  const { origin, pathname } = new URL(call.url);
  if (origin !== HP_ORIGIN) return 'other';
  return DATA_PATH_SET.has(pathname) ? 'graphql' : 'identity';
}

/**
 * Whether a fault is a transport fault, struck on step 0.
 * @param fault - The run's fault.
 * @returns True for a network fault.
 */
function isNetworkFault(fault: HapoalimFault): fault is NetworkFault {
  return fault in NETWORK_FAULTS;
}

/**
 * Answer one call.
 * @param run - The run's fault.
 * @param call - The recorded request.
 * @returns The reply.
 */
function answerHapoalim(run: IMockRun, call: IRecordedCall): Promise<Response> {
  const isStepZero = new URL(call.url).pathname === HP_FIRST_PATH;
  if (isStepZero && isNetworkFault(run.fault)) return NETWORK_FAULTS[run.fault]();
  const route = routeOf(call);
  const response = route(call, run);
  return Promise.resolve(response);
}

/**
 * Install the mock in place of `fetch`.
 * @param fault - How the bank misbehaves this run.
 * @returns The handle that records calls and restores `fetch`.
 */
export function installHapoalimFetchMock(fault: HapoalimFault = 'none'): IMockHandle {
  const run: IMockRun = { fault };
  const answer = answerHapoalim.bind(null, run);
  return installFetchMock({ classify: classifyHapoalim, answer });
}
