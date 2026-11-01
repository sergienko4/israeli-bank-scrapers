/**
 * Yahav mocked bank — how a run misbehaves, the state one run keeps, and the
 * wire check every route reports through. A route that finds its request off
 * spec §10.2 records why and answers 400, so a green run proves every call.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import type { IPresentedCert } from '../../../Scrapers/Pipeline/Strategy/Fetch/Mtls/MtlsAgentSource.js';
import type { IRecordedCall } from '../Helpers/FetchMockKit.js';

/** The BaNCS calls a scrape makes, in order. */
export type BancsCall = 'login' | 'customer' | 'portfolio' | 'accounts' | 'balance' | 'txns';

/** The token call's first answer (a warm run's resume call). */
export type TokenFault = 'token401' | 'token403' | 'token400' | 'token500' | 'tokenTimeout';

/** A registration answer the login must refuse. */
export type RegisterFault = 'deviceStatus' | 'badPem' | 'twoPems' | 'noMag' | 'longMag';

/** A token answer the login must refuse. */
export type GrantFault = 'nonBearer' | 'noExpiry';

/** A BaNCS answer the scrape must refuse, or accept. */
export type BancsFault = 'bankStatus' | 'statusText0' | 'noLoginCsrf';

/** A BaNCS call that answers 401 the first time (or every time) it is hit. */
export type RejectFault = `reject:${BancsCall}` | 'rejectAlways';

export type YahavFault =
  'none' | TokenFault | RegisterFault | GrantFault | BancsFault | RejectFault;

/** What one run's bank remembers between calls. */
export interface IYahavMockState {
  readonly fault: YahavFault;
  /** Every wire check a call failed, as `<METHOD> <path>: <check>`. */
  readonly violations: string[];
  /** Calls answered so far, by route name. */
  readonly hits: Record<string, number>;
  /** The certificate the transport presents for the call being answered. */
  presented: IPresentedCert | false;
  /** What each call presented, in order. */
  readonly presentedLog: (IPresentedCert | false)[];
  /** The device id the initialize call named, for the register call to repeat. */
  deviceId: string;
  /** The BaNCS session generation the next read must echo (0: no login yet). */
  generation: number;
}

/** What a route answers: a response, or a drop that never settles. */
export type RouteReply = Response | Promise<Response>;

/** A route: answers one call (or drops it), updating the run's state. */
export type Route = (call: IRecordedCall, state: IYahavMockState) => RouteReply;

/**
 * A fresh run state.
 * @param fault - How the run misbehaves.
 * @returns State with no calls answered.
 */
export function freshState(fault: YahavFault): IYahavMockState {
  const log = { violations: [], hits: {}, presentedLog: [] };
  return { fault, ...log, presented: false, deviceId: '', generation: 0 };
}

/**
 * Count a hit on a route.
 * @param state - Run state, updated in place.
 * @param name - Route name.
 * @returns How many times the route has now been hit.
 */
export function hit(state: IYahavMockState, name: string): number {
  state.hits[name] = (state.hits[name] ?? 0) + 1;
  return state.hits[name];
}

/**
 * Record each failed wire check of a call.
 * @param state - Run state; failures are appended to its violations.
 * @param call - The call checked.
 * @param checks - Check name → whether it held.
 * @returns True when every check held.
 */
export function checkWire(
  state: IYahavMockState,
  call: IRecordedCall,
  checks: Readonly<Record<string, boolean>>,
): boolean {
  const { pathname } = new URL(call.url);
  const failed = Object.keys(checks).filter(name => !checks[name]);
  const lines = failed.map(name => `${call.method} ${pathname}: ${name}`);
  state.violations.push(...lines);
  return failed.length === 0;
}

/**
 * The checks that a call's headers carry exactly these values.
 * @param call - The call checked.
 * @param expected - Header name → exact value.
 * @returns One `header <name>` check per expected header.
 */
export function headerChecks(
  call: IRecordedCall,
  expected: Readonly<Record<string, string>>,
): Record<string, boolean> {
  const entries = Object.entries(expected);
  const checks = entries.map(([name, value]) => [
    `header ${name}`,
    call.headers.get(name) === value,
  ]);
  return Object.fromEntries(checks) as Record<string, boolean>;
}
