/**
 * The dynamic client-certificate port. A bank whose flow obtains its
 * device certificate at runtime — issued by the bank from a CSR the flow
 * built — declares `clientCert: { mode: 'dynamic', origin }` in its transport
 * config; the node:https mediator then exposes this port, and a flow step
 * installs the issued pair through it. The certificate is presented to the
 * declared origin only and is never written anywhere.
 */

import type { Procedure } from '../Procedure.js';

/** A PEM private key and the PEM certificate issued for it. */
interface IClientCertPair {
  readonly key: string;
  readonly cert: string;
}

/** Installs and clears the run's dynamic client certificate. */
interface IClientCertControl {
  /** Validate the pair and present it from now on; a refused pair keeps the previous one. */
  readonly install: (pair: IClientCertPair) => Procedure<true>;
  /** Stop presenting any certificate. */
  readonly clear: () => true;
}

/** A transport whose certificate the flow installs at runtime. */
interface IDynamicClientCert {
  readonly mode: 'dynamic';
  /** The exact https origin the certificate is presented to. */
  readonly origin: string;
}

export type { IClientCertControl, IClientCertPair, IDynamicClientCert };
