/**
 * Bank-wide option surface for the native fetch strategy: the policies a bank
 * assembles once and the transport applies to every call, plus the default
 * headers each verb sends. Split out of NativeFetchStrategy.ts so the strategy
 * class stays under the per-file LOC ceiling while its public option types
 * remain re-exported from there.
 */

import type {
  IResponseIntegrity,
  MediaTypePolicy,
  RedirectPolicy,
  StatusPolicy,
} from '../../Types/Domain/FetchPolicy.js';
import type { HttpVerb } from './FetchStrategy.js';
import type { IRedirectRun } from './RedirectFollow.js';

/** The request half of a run — what a verb method builds before policy. */
type TRequest = Pick<IRedirectRun, 'url' | 'init' | 'verb'>;

/** Default request headers per verb, merged under the caller's headers. */
type DefaultHeadersByVerb = Readonly<Record<HttpVerb, Readonly<Record<string, string>>>>;

/** Bank-wide policies shared by native REST and GraphQL transports. */
interface INativeFetchOptions {
  readonly redirectPolicy?: RedirectPolicy;
  readonly statusPolicy?: StatusPolicy;
  readonly omitBankText?: boolean;
  /** Media type each response kind must name when a call names none. */
  readonly mediaTypes?: MediaTypePolicy;
  /** Decode every answer as strict UTF-8 unless its call says otherwise. */
  readonly strictUtf8?: boolean;
  readonly responseIntegrity?: IResponseIntegrity;
  readonly isConnectRetryDisabled?: boolean;
  /**
   * Ceiling (ms) for one request, connect through the full body. Setting it
   * installs the capped invoke and lets the transport enforce response
   * integrity; leaving it out keeps the uncapped base transport.
   */
  readonly timeoutMs?: number;
  /** Headers each verb sends under the caller's; absent keeps JSON on every verb. */
  readonly defaultHeaders?: DefaultHeadersByVerb;
  /**
   * Install the cap only when the call names a response-integrity policy.
   * GraphQL uses this so an unbounded query keeps the base transport.
   */
  readonly capOnlyWithIntegrity?: boolean;
}

/** The readonly transport state seeded from bank options. */
interface ITransportSeed {
  readonly timeoutMs?: number;
  readonly capOnlyWithIntegrity: boolean;
  readonly omitBankText: boolean;
  readonly responseIntegrity?: IResponseIntegrity;
  readonly isConnectRetryDisabled: boolean;
}

/**
 * Read the option-derived transport state.
 * @param options - Bank defaults for this transport.
 * @returns The readonly state this constructor installs.
 */
function seedTransport(options: INativeFetchOptions): ITransportSeed {
  return {
    timeoutMs: options.timeoutMs,
    capOnlyWithIntegrity: options.capOnlyWithIntegrity === true,
    omitBankText: options.omitBankText === true,
    responseIntegrity: options.responseIntegrity,
    isConnectRetryDisabled: options.isConnectRetryDisabled === true,
  };
}

/** JSON content-type on every verb — the base strategy's defaults. */
const JSON_DEFAULT_HEADERS: DefaultHeadersByVerb = {
  GET: { 'content-type': 'application/json' },
  POST: { 'content-type': 'application/json' },
};

/** Capped transport defaults: a GET has no body, so only POST names JSON. */
const CAPPED_DEFAULT_HEADERS: DefaultHeadersByVerb = {
  GET: {},
  POST: { 'content-type': 'application/json' },
};

export type { DefaultHeadersByVerb, INativeFetchOptions, ITransportSeed, TRequest };
export { CAPPED_DEFAULT_HEADERS, JSON_DEFAULT_HEADERS, seedTransport };
