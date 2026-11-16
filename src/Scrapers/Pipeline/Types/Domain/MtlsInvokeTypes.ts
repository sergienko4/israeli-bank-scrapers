/**
 * Per-execution mTLS transport settings.
 *
 * <p>The fallback exists so mocked suites can route an mTLS request through
 * their synthetic `fetch` without a real node:https handshake. It is supplied
 * through the pipeline descriptor and mediator arguments, never through a
 * process-wide setter. The timeout is per execution for the same reason: two
 * concurrent runs with different budgets must not share one module variable.
 */

import type { Procedure } from '../Procedure.js';

/** Certificate metadata a mocked transport can observe without a handshake. */
interface IMtlsPresentedCert {
  readonly sha256: string;
}

/** One request handed to an injected mTLS transport. */
interface IMtlsFallbackRequest {
  readonly url: string;
  readonly init: RequestInit;
  readonly verb: 'GET' | 'POST';
  readonly mediaType?: string;
  readonly redactUrlValues?: readonly string[];
  readonly presented: IMtlsPresentedCert | false;
}

/** Injected mTLS transport used by mocked suites. */
type MtlsFallback = (request: IMtlsFallbackRequest) => Promise<Procedure<Response>>;

/** Per-execution mTLS transport settings. */
interface IMtlsInvokeOptions {
  /** Route requests through a mocked transport instead of node:https. */
  readonly fallback?: MtlsFallback;
  /** Per-request timeout; defaults to the production ceiling. */
  readonly timeoutMs?: number;
}

export type { IMtlsFallbackRequest, IMtlsInvokeOptions };
