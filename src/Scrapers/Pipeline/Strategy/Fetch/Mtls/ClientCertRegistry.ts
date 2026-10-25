/**
 * Per-bank client-certificate resolvers for the node:https transport.
 *
 * A bank whose headless config sets `requiresClientCert` presents the
 * certificate its entry here resolves. Adding a bank is one map entry, so the
 * mediator factory never names a bank (OCP). A bank that asks for a client
 * certificate without registering a resolver fails at mediator build instead
 * of reaching the bank edge without one.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import ScraperError from '../../../../Base/ScraperError.js';
import type { ICertBundle } from './OneZeroClientCert.js';
import { resolveOneZeroClientCert } from './OneZeroClientCert.js';

/** Resolves a bank's PEM client certificate + key. */
type ClientCertResolver = () => ICertBundle;

/** Registered client-certificate resolvers, keyed by bank. */
const CLIENT_CERT_RESOLVERS: Readonly<Partial<Record<CompanyTypes, ClientCertResolver>>> = {
  [CompanyTypes.OneZero]: resolveOneZeroClientCert,
};

/** Raised when a bank requires a client certificate it never registered. */
const MISSING_RESOLVER_MSG = 'requiresClientCert is set but no client certificate is registered';

/**
 * Resolves the client certificate a bank presents on every handshake.
 * @param bank - Bank whose headless config requires a client certificate.
 * @returns The bank's PEM certificate + key.
 * @throws ScraperError when the bank has no registered resolver.
 */
function resolveClientCert(bank: CompanyTypes): ICertBundle {
  const resolver = CLIENT_CERT_RESOLVERS[bank];
  if (resolver === undefined) throw new ScraperError(`${MISSING_RESOLVER_MSG} (${bank})`);
  return resolver();
}

export default resolveClientCert;
export { resolveClientCert };
