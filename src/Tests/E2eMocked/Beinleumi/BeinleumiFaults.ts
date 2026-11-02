/**
 * Beinleumi mocked bank — how a run misbehaves, the state one run keeps, and
 * the wire check every route reports through. A route that finds its request
 * off spec §11.2 records why and answers 400, so a green run proves every call.
 *
 * Rule #18: every value here is SYNTHETIC. No real PII.
 */

import { isDeepStrictEqual } from 'node:util';

import type { IRecordedCall } from '../Helpers/FetchMockKit.js';
import type { IFibiMockBrand } from './BeinleumiBrands.js';
import { BEINLEUMI_MOCK_BRAND } from './BeinleumiBrands.js';

/** An assertPassword answer that offers the SMS code, or a shape it cannot take. */
export type OtpFault =
  'otpGenerate' | 'otpValidate' | 'otpSidRefresh' | 'otpVoiceOnly' | 'otpAlphaFormat';

/** A login or assertion answer the run must refuse. */
export type LoginFault = 'locked' | 'expired' | 'plaintextAssert';

/** A login page, hand-off page or SSO answer the run must refuse. */
export type PortalFault =
  'noPasswordEnc' | 'ambiguousHandoff' | 'postMessageHandoff' | 'crossOriginHandoff' | 'sso204';

export type BeinleumiFault = 'none' | OtpFault | LoginFault | PortalFault;

/** What one run's bank remembers between calls. */
export interface IBeinleumiMockState {
  readonly fault: BeinleumiFault;
  /** The bank the mock plays. */
  readonly brand: IFibiMockBrand;
  /** Every wire check a call failed, as `<METHOD> <path>: <check>`. */
  readonly violations: string[];
  /** Calls answered so far, by route name. */
  readonly hits: Record<string, number>;
  /** Each answered call by route name, in order. */
  readonly trail: string[];
  /** The device id every later Transmit call must name ('' until one is known). */
  did: string;
  /** The session id every assertion must name ('' until the login issues one). */
  sid: string;
  /** The flow id the key exchange named; every sealed call repeats it. */
  flowId: string;
  /** The envelope key shared with the client (empty before the key exchange). */
  key: Buffer;
}

/** A route: answers one call, updating the run's state. */
export type Route = (call: IRecordedCall, state: IBeinleumiMockState) => Response;

/**
 * A fresh run state.
 * @param fault - How the run misbehaves.
 * @param did - The device id the client already holds ('' on a cold run).
 * @param brand - The bank the mock plays (default: Beinleumi).
 * @returns State with no calls answered.
 */
export function freshState(
  fault: BeinleumiFault,
  did = '',
  brand: IFibiMockBrand = BEINLEUMI_MOCK_BRAND,
): IBeinleumiMockState {
  const log = { violations: [], hits: {}, trail: [] };
  return { fault, brand, ...log, did, sid: '', flowId: '', key: Buffer.alloc(0) };
}

/**
 * Count a hit on a route and note it on the trail.
 * @param state - Run state, updated in place.
 * @param name - Route name.
 * @returns How many times the route has now been hit.
 */
export function hit(state: IBeinleumiMockState, name: string): number {
  state.hits[name] = (state.hits[name] ?? 0) + 1;
  state.trail.push(name);
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
  state: IBeinleumiMockState,
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

/**
 * Whether a call's query is exactly these parameters, each once.
 * @param call - The call checked.
 * @param expected - Parameter name → exact value.
 * @returns True when the query holds these parameters and no other.
 */
export function isQueryExactly(
  call: IRecordedCall,
  expected: Readonly<Record<string, string>>,
): boolean {
  const { searchParams } = new URL(call.url);
  const entries = [...searchParams.entries()];
  const sent = Object.fromEntries(entries);
  return entries.length === Object.keys(expected).length && isDeepStrictEqual(sent, expected);
}
