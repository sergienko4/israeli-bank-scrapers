/**
 * PEM client-certificate bundle — the cert + matching key a node:https
 * transport presents. Defined in Types so mTLS strategy and mediator contracts
 * share it without depending on a bank module.
 */

/** A resolved PEM certificate + private key pair. */
interface ICertBundle {
  readonly cert: string;
  readonly key: string;
}

export type { ICertBundle };
