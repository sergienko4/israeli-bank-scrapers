/**
 * Unit tests for {@link probeTransportWithDeps} — the DI-driven
 * Node-level transport probe. Tests every reachable outcome path
 * with stubbed `dns`/`tcp`/`tls` deps; no real network I/O.
 *
 * <p>Also includes a small set of integration-style tests that use
 * the production {@link probeTransport} entry point against
 * localhost / `*.invalid` hostnames so the real `dns` / `net` / `tls`
 * wrappers are exercised end-to-end. These are fast (TCP refuses
 * locally in <100ms; DNS for `*.invalid` is RFC2606-reserved so
 * resolves to ENOTFOUND immediately) and have no external network
 * dependency.
 *
 * <p>The probe must:
 *  - resolve `connected` when every phase succeeds (https + http);
 *  - resolve `dns-error` when DNS lookup throws;
 *  - resolve `tcp-timeout` / `tcp-refused` / `tcp-reset` from the
 *    sentinel `TCP_CONNECT_TIMEOUT` string and `ECONNREFUSED` /
 *    `ECONNRESET` codes respectively;
 *  - resolve `other-error` for codes that don't match the table;
 *  - resolve `tls-timeout` from the `TLS_HANDSHAKE_TIMEOUT` sentinel;
 *  - resolve `tls-handshake-error` for any other TLS failure;
 *  - parse explicit ports from the URL.
 */

import type { AddressInfo } from 'node:net';
import * as net from 'node:net';

import {
  type IDnsLookupResult,
  type INavTransportProbe,
  type IProbeRunInput,
  type ITcpHandshakeResult,
  type ITransportProbeDeps,
  probeTransport,
  probeTransportWithDeps,
} from '../../../../../Scrapers/Pipeline/Mediator/Init/NavigationTransportProbe.js';

/** Shared baseline run input for all probe tests. */
const BASE_RUN: IProbeRunInput = {
  targetUrl: 'https://www.fibi.co.il/private/',
  totalBudgetMs: 3000,
  startedMsAfterGotoFailure: 5,
};

/** Successful DNS result returned by most tests. */
const OK_DNS: IDnsLookupResult = { address: '1.2.3.4', family: 4, dnsLookupMs: 12 };

/**
 * Resolved DNS factory used as the default for {@link makeDeps}.
 *
 * @returns A promise that resolves to {@link OK_DNS}.
 */
function okDnsFactory(): Promise<IDnsLookupResult> {
  return Promise.resolve(OK_DNS);
}

/**
 * Resolved TCP-handshake factory used as the default for {@link makeDeps}.
 * Allocates a fresh `net.Socket` each call so the probe's `destroy()`
 * call has a no-op target.
 *
 * @returns A promise that resolves to a stubbed TCP handshake.
 */
function okTcpFactory(): Promise<ITcpHandshakeResult> {
  const handshake: ITcpHandshakeResult = { tcpConnectMs: 23, socket: new net.Socket() };
  return Promise.resolve(handshake);
}

/**
 * Resolved TLS-upgrade factory used as the default for {@link makeDeps}.
 *
 * @returns A promise resolving to the stubbed TLS handshake duration in ms.
 */
function okTlsFactory(): Promise<number> {
  return Promise.resolve(45);
}

/** Bundle of inputs to {@link makeDeps} (`max-params: 3`). */
interface IMakeDepsInput {
  readonly dnsLookup?: ITransportProbeDeps['dnsLookup'];
  readonly tcpConnect?: ITransportProbeDeps['tcpConnect'];
  readonly tlsUpgrade?: ITransportProbeDeps['tlsUpgrade'];
}

/**
 * Build a deps bundle with defaults that succeed everywhere. Tests
 * supply only the deps they want to override.
 *
 * @param input - Optional overrides for any of the three deps.
 * @returns Full deps bundle ready to inject.
 */
function makeDeps(input: IMakeDepsInput = {}): ITransportProbeDeps {
  return {
    dnsLookup: input.dnsLookup ?? okDnsFactory,
    tcpConnect: input.tcpConnect ?? okTcpFactory,
    tlsUpgrade: input.tlsUpgrade ?? okTlsFactory,
  };
}

/**
 * Build a Node ErrnoException with the given code field — the probe
 * uses `.code` to route TCP errors to outcomes.
 *
 * @param message - Error message string.
 * @param code - Errno code string (e.g. `'ECONNREFUSED'`).
 * @returns Error with the `code` property attached.
 */
function makeErrno(message: string, code: string): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

/**
 * Build a DNS-lookup factory that rejects with the given error.
 *
 * @param error - Error to reject the lookup with.
 * @returns DNS-lookup factory always rejecting with `error`.
 */
function makeDnsRejectFactory(error: Error): ITransportProbeDeps['dnsLookup'] {
  return (): Promise<IDnsLookupResult> => Promise.reject(error);
}

/**
 * Build a TCP-connect factory that rejects with the given error.
 *
 * @param error - Error to reject the TCP connect with.
 * @returns TCP-connect factory always rejecting with `error`.
 */
function makeTcpRejectFactory(error: Error): ITransportProbeDeps['tcpConnect'] {
  return (): Promise<ITcpHandshakeResult> => Promise.reject(error);
}

/**
 * Build a TLS-upgrade factory that rejects with the given error.
 *
 * @param error - Error to reject the TLS upgrade with.
 * @returns TLS-upgrade factory always rejecting with `error`.
 */
function makeTlsRejectFactory(error: Error): ITransportProbeDeps['tlsUpgrade'] {
  return (): Promise<number> => Promise.reject(error);
}

describe('probeTransportWithDeps — success paths', () => {
  it('returns connected for an https target when all three phases succeed', async () => {
    const deps = makeDeps();
    const probe = await probeTransportWithDeps({ run: BASE_RUN, deps });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('connected');
    expect(probe.dnsLookupMs).toBe(12);
    expect(probe.tcpConnectMs).toBe(23);
    expect(probe.tlsHandshakeMs).toBe(45);
    expect(probe.resolvedAddress).toBe('1.2.3.4');
    expect(probe.host).toBe('www.fibi.co.il');
    expect(probe.port).toBe(443);
    expect(probe.timing).toBe<INavTransportProbe['timing']>('post-failure');
    expect(probe.startedMsAfterGotoFailure).toBe(5);
    expect(probe.totalBudgetMs).toBe(3000);
  });

  it('skips TLS phase for plain http targets', async () => {
    const httpRun: IProbeRunInput = { ...BASE_RUN, targetUrl: 'http://example.test/' };
    const deps = makeDeps();
    const probe = await probeTransportWithDeps({ run: httpRun, deps });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('connected');
    expect(probe.port).toBe(80);
    expect(probe.tlsHandshakeMs).toBe(0);
  });
});

describe('probeTransportWithDeps — DNS failure', () => {
  it('returns dns-error when dnsLookup rejects', async () => {
    const dnsError = makeErrno('getaddrinfo ENOTFOUND', 'ENOTFOUND');
    const dnsLookup = makeDnsRejectFactory(dnsError);
    const deps = makeDeps({ dnsLookup });
    const probe = await probeTransportWithDeps({ run: BASE_RUN, deps });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('dns-error');
    expect(probe.errorText).toContain('ENOTFOUND');
    expect(probe.dnsLookupMs).toBe(0);
    expect(probe.tcpConnectMs).toBe(0);
    expect(probe.tlsHandshakeMs).toBe(0);
  });
});

describe('probeTransportWithDeps — TCP failure paths', () => {
  it.each([
    ['ECONNREFUSED', 'tcp-refused'],
    ['ECONNRESET', 'tcp-reset'],
    ['ETIMEDOUT', 'tcp-timeout'],
  ])('maps %s to %s', async (code, expected) => {
    const tcpError = makeErrno(`tcp failed: ${code}`, code);
    const tcpConnect = makeTcpRejectFactory(tcpError);
    const deps = makeDeps({ tcpConnect });
    const probe = await probeTransportWithDeps({ run: BASE_RUN, deps });
    expect(probe.outcome).toBe(expected);
    expect(probe.resolvedAddress).toBe('1.2.3.4');
    expect(probe.dnsLookupMs).toBe(12);
  });

  it('maps the TCP_CONNECT_TIMEOUT sentinel to tcp-timeout regardless of code', async () => {
    const tcpError = new Error('TCP_CONNECT_TIMEOUT after 1000ms');
    const tcpConnect = makeTcpRejectFactory(tcpError);
    const deps = makeDeps({ tcpConnect });
    const probe = await probeTransportWithDeps({ run: BASE_RUN, deps });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('tcp-timeout');
  });

  it('maps unknown errno codes to other-error', async () => {
    const tcpError = makeErrno('weird failure', 'EWEIRD');
    const tcpConnect = makeTcpRejectFactory(tcpError);
    const deps = makeDeps({ tcpConnect });
    const probe = await probeTransportWithDeps({ run: BASE_RUN, deps });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('other-error');
    expect(probe.errorText).toContain('weird failure');
  });

  it('maps a TCP error with no code field to other-error', async () => {
    const tcpError = new Error('codeless TCP error');
    const tcpConnect = makeTcpRejectFactory(tcpError);
    const deps = makeDeps({ tcpConnect });
    const probe = await probeTransportWithDeps({ run: BASE_RUN, deps });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('other-error');
    expect(probe.errorText).toContain('codeless TCP error');
  });
});

describe('probeTransportWithDeps — TLS failure paths', () => {
  it('maps TLS_HANDSHAKE_TIMEOUT sentinel to tls-timeout', async () => {
    const tlsError = new Error('TLS_HANDSHAKE_TIMEOUT 1000ms');
    const tlsUpgrade = makeTlsRejectFactory(tlsError);
    const deps = makeDeps({ tlsUpgrade });
    const probe = await probeTransportWithDeps({ run: BASE_RUN, deps });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('tls-timeout');
    expect(probe.tcpConnectMs).toBe(23);
    expect(probe.tlsHandshakeMs).toBe(0);
  });

  it('maps any other TLS failure to tls-handshake-error', async () => {
    const tlsError = new Error('cert verify failed');
    const tlsUpgrade = makeTlsRejectFactory(tlsError);
    const deps = makeDeps({ tlsUpgrade });
    const probe = await probeTransportWithDeps({ run: BASE_RUN, deps });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('tls-handshake-error');
    expect(probe.errorText).toContain('cert verify failed');
  });
});

describe('probeTransportWithDeps — port parsing', () => {
  it('uses an explicit port over the scheme default', async () => {
    const customRun: IProbeRunInput = { ...BASE_RUN, targetUrl: 'https://example.test:8443/' };
    const deps = makeDeps();
    const probe = await probeTransportWithDeps({ run: customRun, deps });
    expect(probe.port).toBe(8443);
  });
});

/**
 * Wait for a `net.Server` to start listening on a random free port,
 * returning the bound port number. Extracted so the integration
 * tests below stay readable.
 *
 * @param server - Server that has had `.listen()` called.
 * @returns Promise resolving to the assigned port.
 */
function awaitListening(server: net.Server): Promise<number> {
  return new Promise(resolve => {
    server.once('listening', (): boolean => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
      return true;
    });
  });
}

/**
 * Close a `net.Server` and resolve when it has finished closing.
 *
 * @param server - Server to close.
 * @returns Promise resolving when `close` callback fires.
 */
function closeServer(server: net.Server): Promise<boolean> {
  return new Promise(resolve => {
    server.close((): boolean => {
      resolve(true);
      return true;
    });
  });
}

describe('probeTransport — integration', () => {
  it('returns dns-error for an RFC2606 .invalid hostname', async () => {
    const probe = await probeTransport({
      targetUrl: 'http://nx-host-must-not-exist-zzz.invalid/',
      totalBudgetMs: 2000,
      startedMsAfterGotoFailure: 0,
    });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('dns-error');
    expect(probe.host).toBe('nx-host-must-not-exist-zzz.invalid');
  });

  it('returns tcp-refused for a plain HTTP probe against 127.0.0.1 with no listener', async () => {
    const probe = await probeTransport({
      targetUrl: 'http://127.0.0.1:1/',
      totalBudgetMs: 2000,
      startedMsAfterGotoFailure: 0,
    });
    expect(probe.outcome).toBe<INavTransportProbe['outcome']>('tcp-refused');
    expect(probe.resolvedAddress).toBe('127.0.0.1');
  });

  it('returns tls-handshake-error when the TCP socket closes mid-handshake', async () => {
    /**
     * TCP listener that accepts the connection then destroys it —
     * forces a TLS handshake error (peer closed before ServerHello).
     *
     * @param socket - Incoming socket (immediately destroyed).
     * @returns Always `true` (no-void rule).
     */
    const onConnection = (socket: net.Socket): boolean => {
      socket.destroy();
      return true;
    };
    const server = net.createServer(onConnection);
    server.listen(0, '127.0.0.1');
    const port = await awaitListening(server);
    try {
      const probe = await probeTransport({
        targetUrl: `https://127.0.0.1:${String(port)}/`,
        totalBudgetMs: 2000,
        startedMsAfterGotoFailure: 0,
      });
      expect(probe.outcome).toBe<INavTransportProbe['outcome']>('tls-handshake-error');
    } finally {
      await closeServer(server);
    }
  });

  it('returns connected for a plain HTTP probe that completes the TCP handshake', async () => {
    /**
     * TCP listener that keeps the socket open long enough for the
     * probe's TLS-phase short-circuit (http target) to resolve.
     *
     * @param socket - Incoming socket; held open by the probe path.
     * @returns Always `true` (no-void rule).
     */
    const onConnection = (socket: net.Socket): boolean => {
      socket.pause();
      return true;
    };
    const server = net.createServer(onConnection);
    server.listen(0, '127.0.0.1');
    const port = await awaitListening(server);
    try {
      const probe = await probeTransport({
        targetUrl: `http://127.0.0.1:${String(port)}/`,
        totalBudgetMs: 2000,
        startedMsAfterGotoFailure: 0,
      });
      expect(probe.outcome).toBe<INavTransportProbe['outcome']>('connected');
      expect(probe.tlsHandshakeMs).toBe(0);
    } finally {
      await closeServer(server);
    }
  });
});
