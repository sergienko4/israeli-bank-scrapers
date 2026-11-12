/**
 * HTTP transport rules — the ordered rule table that picks an API-direct
 * bank's identity transport, plus the guard that rejects a config declaring
 * two mutually-exclusive transports. Split from ApiMediatorWiring to
 * keep that file under the 150-LoC cap.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import ScraperError from '../../Base/ScraperError.js';
import type { IApiWiring, TransportKind } from './ApiWiringTypes.js';

/** Message when a bank misconfigures two identity transports at once. */
const TRANSPORT_CONFLICT_MSG =
  'Conflicting headless transport: node:https (client cert / TLS profile) and native fetch are mutually exclusive';

/** Message when a bank declares no identity transport at all. */
const TRANSPORT_MISSING_MSG =
  'Missing headless transport: declare nativeFetch, a client cert or a TLS profile';

/**
 * Report whether the bank needs the node:https transport — a registered or a
 * dynamic client certificate, a ClientHello profile, or a mix.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when identity + GraphQL must run over node:https.
 */
function usesNodeTls(wiring: IApiWiring): boolean {
  const { tlsProfile, clientCert } = wiring.transport;
  if (wiring.requiresClientCert) return true;
  return tlsProfile !== undefined || clientCert !== undefined;
}

/**
 * Report whether the bank opted into Node's own fetch.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when identity REST must run over native fetch.
 */
function usesNativeFetch(wiring: IApiWiring): boolean {
  return wiring.nativeFetch;
}

/** One transport rule: the first rule whose predicate holds picks the kind. */
interface ITransportRule {
  readonly kind: TransportKind;
  readonly applies: (wiring: IApiWiring) => boolean;
}

/** Ordered transport rules; a bank matching none is a wiring error. */
const TRANSPORT_RULES: readonly ITransportRule[] = [
  { kind: 'node-tls', applies: usesNodeTls },
  { kind: 'native', applies: usesNativeFetch },
];

/** Every explicit transport declaration; a bank may make at most one. */
const TRANSPORT_DECLARATIONS = [usesNodeTls, usesNativeFetch] as const;

/**
 * Guard against a bank requesting two mutually-exclusive identity transports.
 * node:https (client cert and/or TLS profile) and native fetch cannot share
 * identity, so a config declaring both is a wiring bug we fail fast.
 * @param companyId - Target bank company type (for the error message).
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when the transport selection is unambiguous.
 */
function assertSingleTransport(companyId: CompanyTypes, wiring: IApiWiring): boolean {
  const declared = TRANSPORT_DECLARATIONS.filter((isDeclared): boolean => isDeclared(wiring));
  if (declared.length > 1) throw new ScraperError(`${TRANSPORT_CONFLICT_MSG} (${companyId})`);
  return true;
}

/**
 * Pick the transport kind from the ordered rule table.
 * @param companyId - Target bank company type (for the error message).
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns The first matching rule's kind.
 * @throws ScraperError when the transport block declares no transport.
 */
function pickTransportKind(companyId: CompanyTypes, wiring: IApiWiring): TransportKind {
  const match = TRANSPORT_RULES.find((rule): boolean => rule.applies(wiring));
  if (match === undefined) throw new ScraperError(`${TRANSPORT_MISSING_MSG} (${companyId})`);
  return match.kind;
}

export { assertSingleTransport, pickTransportKind };
