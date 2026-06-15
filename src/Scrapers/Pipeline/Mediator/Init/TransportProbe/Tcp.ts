/**
 * TCP phase of the transport probe — opens a raw socket to the
 * resolved address within a per-phase budget. On success the open
 * socket is carried forward to the TLS phase; on failure the Node
 * `ErrnoException.code` (or the `TCP_CONNECT_TIMEOUT` sentinel) is
 * mapped to a discriminated `tcp-*` outcome.
 */

import * as net from 'node:net';

import { toError } from '../../../Types/ErrorUtils.js';
import rejectAndAck from './Reject.js';
import { buildProbeResult } from './Result.js';
import {
  EMPTY_ENVELOPE,
  type IDnsLookupResult,
  type INavTransportProbe,
  type IProbeContext,
  type IProbeEnvelope,
  type ITcpConnectInput,
  type ITcpHandshakeResult,
  type ITransportProbeDeps,
  OUTCOME_OTHER_ERROR,
  type TransportProbeOutcome,
  ZERO_MS,
} from './Types.js';

/**
 * Map a Node ErrnoException code to a probe outcome category. Pulled
 * out so the TCP-phase handler stays small and the mapping table is
 * a single audit point.
 *
 * @param code - The `code` field of a NodeJS.ErrnoException.
 * @returns Outcome to assign when this code is the failure cause.
 */
function categorizeTcpError(code: string): TransportProbeOutcome {
  if (code === 'ECONNREFUSED') return 'tcp-refused';
  if (code === 'ECONNRESET') return 'tcp-reset';
  if (code === 'ETIMEDOUT') return 'tcp-timeout';
  return OUTCOME_OTHER_ERROR;
}

/**
 * Build the timeout handler that destroys the socket after the
 * budget elapses. Extracted to keep {@link defaultTcpConnect} short.
 *
 * @param socket - Socket to destroy on timeout.
 * @returns Handler returning `true` (no-void rule).
 */
function makeTcpTimeoutHandler(socket: net.Socket): () => boolean {
  return (): boolean => {
    socket.destroy(new Error('TCP_CONNECT_TIMEOUT'));
    return true;
  };
}

/** Bundle passed to {@link onTcpConnect} (`max-params: 3`). */
interface ITcpConnectBundle {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly socket: net.Socket;
  readonly start: number;
  readonly resolve: (value: ITcpHandshakeResult) => unknown;
}

/**
 * Handle the TCP `connect` event — clear the budget timer and
 * resolve with the open socket + timing.
 *
 * @param bundle - Timer + socket + start timestamp + resolve hook.
 * @returns `true` (no-void rule).
 */
function onTcpConnect(bundle: ITcpConnectBundle): boolean {
  globalThis.clearTimeout(bundle.timer);
  const tcpConnectMs = Date.now() - bundle.start;
  bundle.resolve({ tcpConnectMs, socket: bundle.socket });
  return true;
}

/** Bundle passed to {@link onTcpError} (`max-params: 3`). */
interface ITcpErrorBundle {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly socket: net.Socket;
  readonly reject: (reason: Error) => unknown;
}

/**
 * Handle the TCP `error` event — clear the budget timer, destroy
 * the socket, and reject the probe Promise.
 *
 * @param bundle - Timer + socket + reject hook.
 * @param socketError - Error emitted by the socket.
 * @returns `true` (no-void rule).
 */
function onTcpError(bundle: ITcpErrorBundle, socketError: Error): boolean {
  globalThis.clearTimeout(bundle.timer);
  bundle.socket.destroy();
  return rejectAndAck(bundle.reject, socketError);
}

/**
 * Open a TCP socket to (host, port) within the budget, returning
 * timing + the connected socket. The socket is left OPEN for the
 * caller (TLS upgrade or test inspection) — caller MUST destroy.
 *
 * @param input - Host + port + wall-clock budget.
 * @returns Promise of timing + socket (resolves on `connect`).
 */
export function defaultTcpConnect(input: ITcpConnectInput): Promise<ITcpHandshakeResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const socket = net.connect({ host: input.host, port: input.port });
    const onTimeout = makeTcpTimeoutHandler(socket);
    const timer = globalThis.setTimeout(onTimeout, input.budgetMs);
    socket.once('connect', (): boolean => onTcpConnect({ timer, socket, start, resolve }));
    socket.once('error', (e: Error): boolean => onTcpError({ timer, socket, reject }, e));
  });
}

/** Tagged result of the TCP phase. */
interface ITcpPhaseOutcome {
  readonly isOk: boolean;
  readonly handshake: ITcpHandshakeResult;
  readonly probe: INavTransportProbe;
}

/** Bundle of inputs to {@link runTcpPhase} (`max-params: 3`). */
export interface IRunTcpInput {
  readonly context: IProbeContext;
  readonly deps: ITransportProbeDeps;
  readonly dns: IDnsLookupResult;
  readonly budgetMs: number;
}

/**
 * Decide which TCP-phase outcome to assign based on the error
 * payload. Looks for the `TCP_CONNECT_TIMEOUT` sentinel first, then
 * falls through to {@link categorizeTcpError}.
 *
 * @param tcpError - Error object from the rejected tcp-connect.
 * @returns Outcome to assign for the failed-probe envelope.
 */
function tcpFailureOutcome(tcpError: Error): TransportProbeOutcome {
  if (tcpError.message.includes('TCP_CONNECT_TIMEOUT')) return 'tcp-timeout';
  const errno = tcpError as NodeJS.ErrnoException;
  const code = errno.code ?? '';
  return categorizeTcpError(code);
}

/**
 * Wrap a {@link buildTcpFailureProbe} call in a tagged failure outcome.
 * Accepts the caught value as `unknown` and normalizes via the
 * downstream probe builder so the always-resolves contract holds
 * even when `tcpConnect` rejects with a non-Error value.
 *
 * @param input - TCP-phase bundle (context + deps + DNS result + budget).
 * @param tcpError - Caught value from the rejected tcp-connect.
 * @returns Tagged not-OK TCP outcome with the categorized probe envelope.
 */
function buildTcpFailureOutcome(input: IRunTcpInput, tcpError: unknown): ITcpPhaseOutcome {
  return {
    isOk: false,
    handshake: buildHandshakePlaceholder2(),
    probe: buildTcpFailureProbe(input, tcpError),
  };
}

/**
 * Build the {@link ITcpConnectInput} from the TCP-phase bundle. Pure
 * field mapping; pulled out so {@link runTcpPhase} avoids a nested
 * call (forbidden by lint) when calling `deps.tcpConnect`.
 *
 * @param input - TCP-phase bundle (context + deps + DNS result + budget).
 * @returns The host / port / budget bundle the connector expects.
 */
function makeTcpConnectInput(input: IRunTcpInput): ITcpConnectInput {
  return { host: input.dns.address, port: input.context.url.port, budgetMs: input.budgetMs };
}

/**
 * TCP phase: connect to the resolved address. On success returns an
 * OK outcome carrying the handshake (socket left open); on failure
 * returns a not-OK outcome carrying a fully-built probe envelope.
 *
 * @param input - Context + deps + DNS result + per-phase budget.
 * @returns Tagged outcome (success carries TCP handshake, failure carries probe).
 */
export async function runTcpPhase(input: IRunTcpInput): Promise<ITcpPhaseOutcome> {
  const tcpInput = makeTcpConnectInput(input);
  try {
    const handshake = await input.deps.tcpConnect(tcpInput);
    return { isOk: true, handshake, probe: buildHandshakePlaceholder(input.context) };
  } catch (tcpError) {
    return buildTcpFailureOutcome(input, tcpError);
  }
}

/**
 * Build the TCP-failure envelope (DNS timing carried forward, TCP/TLS
 * fields left empty, error message carried in `errorText`).
 *
 * @param dns - DNS phase result (address + lookup timing).
 * @param message - Error message from the rejected tcp-connect.
 * @returns Envelope sized for the failed-probe path.
 */
function makeTcpFailureEnvelope(dns: IDnsLookupResult, message: string): IProbeEnvelope {
  return {
    ...EMPTY_ENVELOPE,
    dnsLookupMs: dns.dnsLookupMs,
    resolvedAddress: dns.address,
    errorText: message,
  };
}

/**
 * Build the failure-probe envelope for the TCP phase. Accepts the
 * caught value as `unknown` and normalizes via {@link toError} so
 * `tcpFailureOutcome` and `makeTcpFailureEnvelope` see a real Error
 * even when the dep rejects with a non-Error value.
 *
 * @param input - TCP-phase bundle (context + deps + DNS result + budget).
 * @param tcpError - Caught value from the rejected tcp-connect.
 * @returns Probe envelope tagged with the categorized TCP outcome.
 */
function buildTcpFailureProbe(input: IRunTcpInput, tcpError: unknown): INavTransportProbe {
  const normalized = toError(tcpError);
  const envelope = makeTcpFailureEnvelope(input.dns, normalized.message);
  const outcome = tcpFailureOutcome(normalized);
  return buildProbeResult({ context: input.context, outcome, envelope });
}

/**
 * Placeholder probe returned alongside an OK TCP outcome (never read).
 *
 * @param context - Probe context (target/host metadata + timing baseline).
 * @returns Synthetic probe shaped like an `other-error` failure; never inspected.
 */
function buildHandshakePlaceholder(context: IProbeContext): INavTransportProbe {
  return buildProbeResult({ context, outcome: OUTCOME_OTHER_ERROR, envelope: EMPTY_ENVELOPE });
}

/**
 * Placeholder handshake returned alongside a not-OK outcome (never read).
 *
 * @returns Synthetic TCP handshake with zero timing and an unconnected socket.
 */
function buildHandshakePlaceholder2(): ITcpHandshakeResult {
  return { tcpConnectMs: ZERO_MS, socket: new net.Socket() };
}
