/**
 * HTTPS agent that holds every TLS session to its profile's protocol.
 *
 * A fingerprint profile can offer handshake options it must never settle on.
 * The Android profile keeps TLS 1.2 and `rsa_pkcs1_sha1` in its ClientHello at
 * `@SECLEVEL=0` so the JA4 matches, which would let a TLS 1.2 server sign the
 * handshake with SHA-1; the server-certificate floor sees only the chain.
 * TLS 1.3 forbids SHA-1 and PKCS#1 v1.5 handshake signatures, so that profile
 * pins its sessions to TLS 1.3. The ClientHello is unchanged: the agent reads
 * the negotiated protocol on `secureConnect` and destroys the socket before
 * the request is written.
 */

import { Agent, type AgentOptions } from 'node:https';
import { type SecureVersion, TLSSocket } from 'node:tls';

/** Refusal reason when a session settles on a protocol the profile forbids. */
const SESSION_PROTOCOL_REASON = 'server negotiated a TLS version the profile does not allow';

/** Protocol a session must settle on; empty accepts whatever OpenSSL negotiates. */
type SessionProtocol = SecureVersion | '';

/** Arguments of `Agent#createConnection`. */
type ConnectionArgs = Parameters<Agent['createConnection']>;

/** Socket `Agent#createConnection` hands to the request. */
type Connection = ReturnType<Agent['createConnection']>;

/**
 * Destroys a session that settled on any protocol but the required one.
 * @param socket - The connected TLS socket.
 * @param required - Protocol the session must use.
 * @returns True when the session may carry the request.
 */
function enforceSessionProtocol(socket: TLSSocket, required: SecureVersion): boolean {
  if (socket.getProtocol() === required) return true;
  const refusal = new Error(SESSION_PROTOCOL_REASON);
  socket.destroy(refusal);
  return false;
}

/**
 * Arms the protocol check on a new connection. A connection that is not a TLS
 * socket cannot report its protocol, so it is refused.
 * @param connection - Socket the base agent created.
 * @param required - Protocol the session must settle on; empty skips the check.
 * @returns The same connection.
 */
function guardSessionProtocol(connection: Connection, required: SessionProtocol): Connection {
  if (required === '') return connection;
  if (connection instanceof TLSSocket) {
    connection.once('secureConnect', (): boolean => enforceSessionProtocol(connection, required));
    return connection;
  }
  connection?.destroy(new Error(SESSION_PROTOCOL_REASON));
  return connection;
}

/** `https.Agent` that refuses a session settled on a protocol its profile forbids. */
class SessionProtocolAgent extends Agent {
  private readonly _required: SessionProtocol;

  /**
   * Creates the agent.
   * @param options - Agent and TLS options.
   * @param required - Protocol every session must settle on; empty accepts any.
   */
  constructor(options: AgentOptions, required: SessionProtocol) {
    super(options);
    this._required = required;
  }

  /**
   * Creates the base agent's TLS socket with the protocol check armed.
   * @param args - The base agent's connection arguments.
   * @returns The armed socket.
   */
  public override createConnection(...args: ConnectionArgs): Connection {
    const connection = super.createConnection(...args);
    return guardSessionProtocol(connection, this._required);
  }
}

export type { SessionProtocol };
export { guardSessionProtocol, SESSION_PROTOCOL_REASON, SessionProtocolAgent };
