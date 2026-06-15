/**
 * TLS phase of the transport probe — upgrades the open TCP socket to
 * TLS (SNI = target host) within a per-phase budget, then immediately
 * tears the socket down (observation-only). Plain-HTTP targets skip
 * the handshake and report `connected`. This is the terminal phase, so
 * it always produces the final probe envelope.
 */

import * as tls from 'node:tls';

import { toError } from '../../../Types/ErrorUtils.js';
import rejectAndAck from './Reject.js';
import { buildProbeResult } from './Result.js';
import {
  type IDnsLookupResult,
  type INavTransportProbe,
  type IProbeContext,
  type IProbeEnvelope,
  type ITcpHandshakeResult,
  type ITlsUpgradeInput,
  type ITransportProbeDeps,
  type TransportProbeOutcome,
  ZERO_MS,
} from './Types.js';

/**
 * Build the timeout handler that destroys the TLS socket after the
 * budget elapses. Extracted to keep {@link defaultTlsUpgrade} short.
 *
 * @param tlsSocket - TLS socket to destroy on timeout.
 * @returns Handler returning `true` (no-void rule).
 */
function makeTlsTimeoutHandler(tlsSocket: tls.TLSSocket): () => boolean {
  return (): boolean => {
    tlsSocket.destroy(new Error('TLS_HANDSHAKE_TIMEOUT'));
    return true;
  };
}

/** Bundle passed to {@link onTlsSecureConnect} (`max-params: 3`). */
interface ITlsSecureConnectBundle {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly tlsSocket: tls.TLSSocket;
  readonly start: number;
  readonly resolve: (value: number) => unknown;
}

/**
 * Handle the TLS `secureConnect` event — clear the timer, destroy
 * the TLS socket (probe is observation-only), and resolve with the
 * handshake duration.
 *
 * @param bundle - Timer + TLS socket + start timestamp + resolve hook.
 * @returns `true` (no-void rule).
 */
function onTlsSecureConnect(bundle: ITlsSecureConnectBundle): boolean {
  globalThis.clearTimeout(bundle.timer);
  bundle.tlsSocket.destroy();
  bundle.resolve(Date.now() - bundle.start);
  return true;
}

/** Bundle passed to {@link onTlsError} (`max-params: 3`). */
interface ITlsErrorBundle {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly tlsSocket: tls.TLSSocket;
  readonly reject: (reason: Error) => unknown;
}

/**
 * Handle the TLS `error` event — clear the timer, destroy the TLS
 * socket, and reject the probe Promise.
 *
 * @param bundle - Timer + TLS socket + reject hook.
 * @param tlsError - Error emitted by the TLS socket.
 * @returns `true` (no-void rule).
 */
function onTlsError(bundle: ITlsErrorBundle, tlsError: Error): boolean {
  globalThis.clearTimeout(bundle.timer);
  bundle.tlsSocket.destroy();
  return rejectAndAck(bundle.reject, tlsError);
}

/**
 * Bundle passed to {@link attachTlsHandlers} (`max-params: 3`).
 * Carries everything both the success and error paths need.
 */
interface ITlsHandlersInput {
  readonly tlsSocket: tls.TLSSocket;
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly start: number;
  readonly resolve: (value: number) => unknown;
  readonly reject: (reason: Error) => unknown;
}

/**
 * Wire both `secureConnect` and `error` once-listeners onto the TLS
 * socket. Extracted so {@link defaultTlsUpgrade} stays ≤10 LoC and
 * the two listener arrows remain ≤100 chars each.
 *
 * @param input - TLS socket + timer + Promise hooks.
 * @returns `true` (no-void rule).
 */
function attachTlsHandlers(input: ITlsHandlersInput): boolean {
  const { tlsSocket, timer, start, resolve, reject } = input;
  /**
   * Wire TLS `secureConnect` → resolve probe Promise with timing.
   *
   * @returns `true` (no-void rule).
   */
  const onOk = (): boolean => onTlsSecureConnect({ timer, tlsSocket, start, resolve });
  /**
   * Wire TLS `error` → reject probe Promise with the underlying error.
   *
   * @param error - Error emitted by the TLS socket.
   * @returns `true` (no-void rule).
   */
  const onErr = (error: Error): boolean => onTlsError({ timer, tlsSocket, reject }, error);
  tlsSocket.once('secureConnect', onOk);
  tlsSocket.once('error', onErr);
  return true;
}

/**
 * Upgrade an open TCP socket to TLS, returning handshake timing in
 * ms. Destroys the TLS socket on resolution to free the underlying
 * TCP socket — the probe does not need to read any data.
 *
 * @param input - Open TCP handshake + SNI servername + budget.
 * @returns Promise of handshake duration in ms (resolves on `secureConnect`).
 */
export function defaultTlsUpgrade(input: ITlsUpgradeInput): Promise<number> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tlsSocket = tls.connect({ socket: input.tcp.socket, servername: input.servername });
    const onTimeout = makeTlsTimeoutHandler(tlsSocket);
    const timer = globalThis.setTimeout(onTimeout, input.budgetMs);
    attachTlsHandlers({ tlsSocket, timer, start, resolve, reject });
  });
}

/** Bundle of inputs to {@link runTlsPhase} (`max-params: 3`). */
export interface IRunTlsInput {
  readonly context: IProbeContext;
  readonly deps: ITransportProbeDeps;
  readonly dns: IDnsLookupResult;
  readonly tcp: ITcpHandshakeResult;
  readonly budgetMs: number;
}

/**
 * Decide which TLS-phase outcome to assign based on the error
 * payload. Looks for the `TLS_HANDSHAKE_TIMEOUT` sentinel.
 *
 * @param tlsError - Error object from the rejected tls-upgrade.
 * @returns Outcome to assign for the failed-probe envelope.
 */
function tlsFailureOutcome(tlsError: Error): TransportProbeOutcome {
  if (tlsError.message.includes('TLS_HANDSHAKE_TIMEOUT')) return 'tls-timeout';
  return 'tls-handshake-error';
}

/**
 * Build the success-path probe envelope (post-TCP / post-TLS).
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @param tlsMs - Measured TLS handshake duration in milliseconds (0 for plain HTTP).
 * @returns Probe envelope tagged with the `connected` outcome.
 */
function buildSuccessProbe(input: IRunTlsInput, tlsMs: number): INavTransportProbe {
  const envelope: IProbeEnvelope = {
    dnsLookupMs: input.dns.dnsLookupMs,
    tcpConnectMs: input.tcp.tcpConnectMs,
    tlsHandshakeMs: tlsMs,
    resolvedAddress: input.dns.address,
    errorText: '',
  };
  return buildProbeResult({ context: input.context, outcome: 'connected', envelope });
}

/** Bundle of inputs to {@link makeTlsFailureEnvelope} (`max-params: 3`). */
interface ITlsFailureEnvInput {
  readonly dns: IDnsLookupResult;
  readonly tcp: ITcpHandshakeResult;
  readonly message: string;
}

/**
 * Build the TLS-failure envelope (DNS + TCP timings carried forward,
 * TLS reset to zero, error message carried in `errorText`).
 *
 * @param input - DNS result + TCP result + error message.
 * @returns Envelope sized for the failed-probe path.
 */
function makeTlsFailureEnvelope(input: ITlsFailureEnvInput): IProbeEnvelope {
  return {
    dnsLookupMs: input.dns.dnsLookupMs,
    tcpConnectMs: input.tcp.tcpConnectMs,
    tlsHandshakeMs: ZERO_MS,
    resolvedAddress: input.dns.address,
    errorText: input.message,
  };
}

/**
 * Build the failure-path probe envelope for the TLS phase. Accepts
 * the caught value as `unknown` and normalizes via {@link toError}
 * so `tlsFailureOutcome` and `makeTlsFailureEnvelope` see a real
 * Error even when the dep rejects with a non-Error value.
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @param tlsError - Caught value from the rejected tls-upgrade.
 * @returns Probe envelope tagged with the categorized TLS outcome.
 */
function buildTlsFailureProbe(input: IRunTlsInput, tlsError: unknown): INavTransportProbe {
  const { dns, tcp } = input;
  const normalized = toError(tlsError);
  const envelope = makeTlsFailureEnvelope({ dns, tcp, message: normalized.message });
  const outcome = tlsFailureOutcome(normalized);
  return buildProbeResult({ context: input.context, outcome, envelope });
}

/**
 * Build the {@link ITlsUpgradeInput} from the TLS-phase bundle. Pure
 * field mapping; pulled out so {@link runTlsPhase}'s try-branch fits
 * the 10-LoC cap.
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @returns The tcp / servername / budget bundle the upgrader expects.
 */
function makeTlsUpgradeInput(input: IRunTlsInput): ITlsUpgradeInput {
  return { tcp: input.tcp, servername: input.context.url.host, budgetMs: input.budgetMs };
}

/**
 * Attempt the TLS handshake; on success return the connected probe,
 * on failure destroy the underlying socket and return the categorized
 * failure probe. Extracted from {@link runTlsPhase} to stay ≤ 10 LoC.
 *
 * @param input - TLS-phase bundle (context + deps + DNS + TCP + budget).
 * @returns Final probe envelope (success or failure).
 */
async function attemptTlsUpgrade(input: IRunTlsInput): Promise<INavTransportProbe> {
  const tlsInput = makeTlsUpgradeInput(input);
  try {
    const tlsMs = await input.deps.tlsUpgrade(tlsInput);
    return buildSuccessProbe(input, tlsMs);
  } catch (tlsError) {
    input.tcp.socket.destroy();
    return buildTlsFailureProbe(input, tlsError);
  }
}

/**
 * TLS phase: optional handshake when isTls, else destroy the TCP
 * socket and return a `'connected'` envelope. Always builds a probe
 * envelope — this is the terminal phase of the probe.
 *
 * @param input - Context + deps + DNS + open TCP + per-phase budget.
 * @returns The final probe envelope.
 */
export async function runTlsPhase(input: IRunTlsInput): Promise<INavTransportProbe> {
  if (!input.context.url.isTls) {
    input.tcp.socket.destroy();
    return buildSuccessProbe(input, ZERO_MS);
  }
  return attemptTlsUpgrade(input);
}
