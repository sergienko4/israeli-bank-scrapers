/**
 * Headless transport rules — the ordered rule table that picks a headless
 * bank's identity transport, plus the guard that rejects a config declaring
 * two mutually-exclusive transports. Split from HeadlessMediatorWiring to
 * keep that file under the 150-LoC cap.
 */

import type { CompanyTypes } from '../../../Definitions.js';
import ScraperError from '../../Base/ScraperError.js';
import type { HeadlessTransportKind, IHeadlessWiring } from './HeadlessWiringTypes.js';

/** Message when a bank misconfigures two identity transports at once. */
const TRANSPORT_CONFLICT_MSG =
  'Conflicting headless transport: node:https (client cert / TLS profile), native fetch and browser-TLS are mutually exclusive';

/**
 * Report whether the bank needs the node:https transport — a registered or a
 * dynamic client certificate, a ClientHello profile, or a mix.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when identity + GraphQL must run over node:https.
 */
function usesNodeTls(wiring: IHeadlessWiring): boolean {
  const { tlsProfile, clientCert } = wiring.transport;
  if (wiring.requiresClientCert) return true;
  return tlsProfile !== undefined || clientCert !== undefined;
}

/**
 * Report whether the bank opted into Node's own fetch.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when identity REST must run over native fetch.
 */
function usesNativeFetch(wiring: IHeadlessWiring): boolean {
  return wiring.nativeFetch;
}

/**
 * Report whether the bank explicitly asked for browser TLS.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when identity REST must run through Camoufox.
 */
function usesBrowserTls(wiring: IHeadlessWiring): boolean {
  return wiring.requiresBrowserTls;
}

/** One transport rule: the first rule whose predicate holds picks the kind. */
interface ITransportRule {
  readonly kind: HeadlessTransportKind;
  readonly applies: (wiring: IHeadlessWiring) => boolean;
}

/** Ordered transport rules; a bank matching none runs browser-backed. */
const TRANSPORT_RULES: readonly ITransportRule[] = [
  { kind: 'node-tls', applies: usesNodeTls },
  { kind: 'native', applies: usesNativeFetch },
];

/** Every explicit transport declaration; a bank may make at most one. */
const TRANSPORT_DECLARATIONS = [usesNodeTls, usesNativeFetch, usesBrowserTls] as const;

/**
 * Guard against a bank requesting two mutually-exclusive identity transports.
 * node:https (client cert and/or TLS profile), native fetch and browser-TLS
 * (Camoufox) cannot share identity, so a config declaring more than one is a
 * wiring bug we fail fast.
 * @param companyId - Target bank company type (for the error message).
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns True when the transport selection is unambiguous.
 */
function assertSingleTransport(
  companyId: CompanyTypes,
  wiring: IHeadlessWiring,
): boolean {
  const declared = TRANSPORT_DECLARATIONS.filter((isDeclared): boolean => isDeclared(wiring));
  if (declared.length > 1) throw new ScraperError(`${TRANSPORT_CONFLICT_MSG} (${companyId})`);
  return true;
}

/**
 * Pick the transport kind from the ordered rule table.
 * @param wiring - Resolved wiring entry (URLs + flags).
 * @returns The first matching rule's kind, else the browser-backed default.
 */
function pickTransportKind(wiring: IHeadlessWiring): HeadlessTransportKind {
  const match = TRANSPORT_RULES.find((rule): boolean => rule.applies(wiring));
  return match?.kind ?? 'browser';
}

export { assertSingleTransport, pickTransportKind };
