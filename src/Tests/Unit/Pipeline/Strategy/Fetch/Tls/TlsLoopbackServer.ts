/**
 * Loopback HTTPS server and request helper for the TLS suites that run a real
 * handshake through a transport agent. The server answers every request with
 * `ok` and counts them, so a test can prove a refusal happened before the
 * request reached it.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type Agent,
  createServer,
  request,
  type RequestOptions,
  type Server,
  type ServerOptions,
} from 'node:https';

import { boundPort, decodePem, makeClose } from '../Mtls/MtlsTestServer.js';

/** A loopback HTTPS server presenting one fixture leaf. */
interface ILeafServer {
  readonly port: number;
  readonly requests: () => number;
  readonly close: () => Promise<void>;
}

/** Outcome of one loopback request. */
interface IRequestOutcome {
  readonly status: number;
  readonly error: string;
}

/**
 * Start a loopback server for one leaf. The server runs at security level 0 so
 * it can present the weak fixtures at all; the client decides what to accept.
 * @param certB64 - Leaf certificate fixture.
 * @param keyB64 - Leaf key fixture.
 * @param tls - Further server TLS options, e.g. a protocol or signature cap.
 * @returns The running server.
 */
function startLeafServer(
  certB64: string,
  keyB64: string,
  tls: ServerOptions = {},
): Promise<ILeafServer> {
  const counter = { hits: 0 };
  const cert = decodePem(certB64);
  const key = decodePem(keyB64);
  const options = { cert, key, ciphers: 'DEFAULT@SECLEVEL=0', ...tls };
  const server: Server = createServer(options, (_req: IncomingMessage, res: ServerResponse) => {
    counter.hits += 1;
    res.end('ok');
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = boundPort(server);
      const close = makeClose(server);
      /**
       * Requests the server handler has answered so far.
       * @returns The handled-request count.
       */
      const requests = (): number => counter.hits;
      resolve({ port, requests, close });
    });
  });
}

/**
 * Send one GET through an agent.
 * @param port - Loopback server port.
 * @param agent - Agent under test.
 * @param extra - The `ca` to trust, plus e.g. a `servername` to check against.
 * @returns The response status, or the connection error message.
 */
function fetchOutcome(port: number, agent: Agent, extra: RequestOptions): Promise<IRequestOutcome> {
  const options = { host: '127.0.0.1', port, path: '/', agent, ...extra };
  return new Promise(resolve => {
    const req = request(options, res => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, error: '' });
    });
    req.on('error', (error: Error) => {
      resolve({ status: 0, error: error.message });
    });
    req.end();
  });
}

export type { ILeafServer, IRequestOutcome };
export { fetchOutcome, startLeafServer };
