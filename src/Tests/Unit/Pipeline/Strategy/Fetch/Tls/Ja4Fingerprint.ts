/**
 * JA4 fingerprint capture for TLS transport tests.
 *
 * Opens a loopback TCP listener, sends one HTTPS request through the agent
 * under test and reads the raw ClientHello that agent emits. Nothing answers
 * the handshake, so no certificate, server identity or network is involved.
 * The fingerprint follows the published JA4 TLS-client definition: a prefix
 * of protocol, TLS version, SNI presence, cipher and extension counts and
 * ALPN, then truncated SHA-256 hashes of the sorted cipher suites and of the
 * sorted extensions joined with the signature algorithms in wire order.
 */

import { createHash } from 'node:crypto';
import { type Agent, request } from 'node:https';
import { type AddressInfo, createServer, type Server, type Socket } from 'node:net';

/** Server name the request sends; JA4 records only that SNI is present. */
const SNI_HOST = 'bank.example';

/** Loopback address the capture listener binds. */
const LOOPBACK = '127.0.0.1';

/** TLS record header: content type (1), version (2), length (2). */
const RECORD_HEADER_BYTES = 5;

/** Session-id length offset: record (5) + handshake (4) + version (2) + random (32). */
const SESSION_ID_OFFSET = 43;

/** Extension types JA4 reads or excludes. */
const EXT = { sni: 0x0000, sigalgs: 0x000d, alpn: 0x0010, supportedVersions: 0x002b } as const;

/** JA4 version labels for the highest offered TLS version. */
const TLS_VERSION_LABELS: Readonly<Record<number, string>> = { 0x0304: '13', 0x0303: '12' };

/** JA4 SNI flag: `d` when a server name is sent, `i` when the target is a bare IP. */
const SNI_FLAGS: Readonly<Record<string, string>> = { true: 'd', false: 'i' };

/** One ClientHello extension: its type and raw payload. */
interface ITlsExtension {
  readonly type: number;
  readonly data: Buffer;
}

/** The ClientHello fields JA4 reads. */
interface IClientHello {
  readonly ciphers: readonly number[];
  readonly extensions: readonly ITlsExtension[];
}

/**
 * Reports whether a value is a GREASE placeholder, which JA4 ignores.
 * @param value - Cipher, extension or version code.
 * @returns True for the reserved `0x?a?a` GREASE values.
 */
function isGrease(value: number): boolean {
  return (value & 0x0f0f) === 0x0a0a;
}

/**
 * Reads a run of big-endian uint16 codes, dropping GREASE values.
 * @param data - Buffer holding the run.
 * @param start - Offset of the first code.
 * @param byteLength - Length of the run in bytes.
 * @returns The non-GREASE codes in wire order.
 */
function readUint16List(data: Buffer, start: number, byteLength: number): number[] {
  const values: number[] = [];
  for (let offset = 0; offset < byteLength; offset += 2) {
    const value = data.readUInt16BE(start + offset);
    values.push(value);
  }
  return values.filter((value): boolean => !isGrease(value));
}

/**
 * Reads the extension block that ends the ClientHello.
 * @param hello - Raw ClientHello record.
 * @param start - Offset of the extensions length field.
 * @returns The non-GREASE extensions in wire order.
 */
function readExtensions(hello: Buffer, start: number): ITlsExtension[] {
  const end = start + 2 + hello.readUInt16BE(start);
  const extensions: ITlsExtension[] = [];
  for (let cursor = start + 2; cursor < end; cursor += 4 + hello.readUInt16BE(cursor + 2)) {
    const dataEnd = cursor + 4 + hello.readUInt16BE(cursor + 2);
    const type = hello.readUInt16BE(cursor);
    extensions.push({ type, data: hello.subarray(cursor + 4, dataEnd) });
  }
  return extensions.filter((extension): boolean => !isGrease(extension.type));
}

/**
 * Parses the cipher suites and extensions out of a raw ClientHello record.
 * @param hello - Raw ClientHello record, starting at the TLS record header.
 * @returns The cipher suites and extensions.
 */
function parseClientHello(hello: Buffer): IClientHello {
  const cipherStart = SESSION_ID_OFFSET + 1 + hello.readUInt8(SESSION_ID_OFFSET);
  const cipherBytes = hello.readUInt16BE(cipherStart);
  const compressionStart = cipherStart + 2 + cipherBytes;
  const extensionsStart = compressionStart + 1 + hello.readUInt8(compressionStart);
  const ciphers = readUint16List(hello, cipherStart + 2, cipherBytes);
  const extensions = readExtensions(hello, extensionsStart);
  return { ciphers, extensions };
}

/**
 * Finds an extension's payload.
 * @param hello - Parsed ClientHello.
 * @param type - Extension type to find.
 * @returns The payload, or an empty buffer when the extension is absent.
 */
function extensionData(hello: IClientHello, type: number): Buffer {
  const match = hello.extensions.find((extension): boolean => extension.type === type);
  return match?.data ?? Buffer.alloc(0);
}

/**
 * Reads the signature algorithms in wire order.
 * @param hello - Parsed ClientHello.
 * @returns Signature-algorithm codes, empty when the extension is absent.
 */
function readSigalgs(hello: IClientHello): number[] {
  const data = extensionData(hello, EXT.sigalgs);
  if (data.length === 0) return [];
  const byteLength = data.readUInt16BE(0);
  return readUint16List(data, 2, byteLength);
}

/**
 * Reads the first ALPN protocol offered.
 * @param hello - Parsed ClientHello.
 * @returns The protocol name, empty when ALPN is absent.
 */
function readAlpn(hello: IClientHello): string {
  const data = extensionData(hello, EXT.alpn);
  if (data.length === 0) return '';
  return data.toString('latin1', 3, 3 + data.readUInt8(2));
}

/**
 * Labels the highest TLS version offered in supported_versions.
 * @param hello - Parsed ClientHello.
 * @returns JA4 version label, e.g. `13`; `00` when unknown.
 */
function versionLabel(hello: IClientHello): string {
  const data = extensionData(hello, EXT.supportedVersions);
  const byteLength = data.readUInt8(0);
  const versions = readUint16List(data, 1, byteLength);
  const highest = Math.max(...versions);
  return TLS_VERSION_LABELS[highest] ?? '00';
}

/**
 * Builds the JA4 prefix: protocol, version, SNI flag, counts and ALPN.
 * @param hello - Parsed ClientHello.
 * @returns The JA4 `a` section, e.g. `t13d1513h1`.
 */
function ja4Prefix(hello: IClientHello): string {
  const hasSni = hello.extensions.some((extension): boolean => extension.type === EXT.sni);
  const alpn = readAlpn(hello);
  const alpnTag = `${alpn.at(0) ?? '0'}${alpn.at(-1) ?? '0'}`;
  const ciphers = String(hello.ciphers.length).padStart(2, '0');
  const extensions = String(hello.extensions.length).padStart(2, '0');
  return `t${versionLabel(hello)}${SNI_FLAGS[String(hasSni)]}${ciphers}${extensions}${alpnTag}`;
}

/**
 * Hashes a code list the way JA4 does.
 * @param codes - Codes to render as 4-digit hex.
 * @param suffix - Text appended after the joined codes.
 * @returns First 12 hex characters of the SHA-256 digest.
 */
function hashCodes(codes: readonly number[], suffix: string): string {
  const hex = codes.map((code): string => code.toString(16).padStart(4, '0'));
  return createHash('sha256')
    .update(`${hex.join(',')}${suffix}`)
    .digest('hex')
    .slice(0, 12);
}

/**
 * Computes the JA4 fingerprint of a raw ClientHello, whether captured here or
 * recorded from a real device.
 * @param rawHello - Raw ClientHello record, starting at the TLS record header.
 * @returns The JA4 fingerprint, e.g. `t13d1513h1_8daaf6152771_eca864cca44a`.
 */
function computeJa4(rawHello: Buffer): string {
  const hello = parseClientHello(rawHello);
  const ciphers = [...hello.ciphers].sort((left, right): number => left - right);
  const hashed = hello.extensions.filter(
    (ext): boolean => ext.type !== EXT.sni && ext.type !== EXT.alpn,
  );
  const types = hashed.map((ext): number => ext.type).sort((left, right): number => left - right);
  const sigalgs = readSigalgs(hello).map((code): string => code.toString(16).padStart(4, '0'));
  return `${ja4Prefix(hello)}_${hashCodes(ciphers, '')}_${hashCodes(types, `_${sigalgs.join(',')}`)}`;
}

/**
 * Reports whether the buffered bytes hold a complete TLS record.
 * @param buffered - Bytes received so far.
 * @returns True once the first record's declared length has arrived.
 */
function isRecordComplete(buffered: Buffer): boolean {
  if (buffered.length < RECORD_HEADER_BYTES) return false;
  return buffered.length >= RECORD_HEADER_BYTES + buffered.readUInt16BE(3);
}

/**
 * Waits for the first connection a listener accepts.
 * @param server - Listener to watch.
 * @returns The accepted socket.
 */
function acceptOnce(server: Server): Promise<Socket> {
  return new Promise<Socket>(resolve => {
    server.once('connection', resolve);
  });
}

/**
 * Buffers a socket's bytes until the ClientHello record is complete. The
 * socket stays paused until the data listener attaches, so no bytes are lost.
 * @param socket - Accepted loopback socket.
 * @returns The complete ClientHello record.
 */
function readClientHello(socket: Socket): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise<Buffer>(resolve => {
    socket.on('data', (chunk: Buffer): boolean => {
      chunks.push(chunk);
      const buffered = Buffer.concat(chunks);
      if (!isRecordComplete(buffered)) return false;
      socket.destroy();
      resolve(buffered);
      return true;
    });
  });
}

/**
 * Starts a loopback listener on an ephemeral port.
 * @param server - Listener to start.
 * @returns The bound port.
 */
function listenOnLoopback(server: Server): Promise<number> {
  return new Promise<number>(resolve => {
    server.listen(0, LOOPBACK, () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

/**
 * Sends one HTTPS request through the agent; the handshake never completes.
 * @param agent - Agent under test.
 * @param port - Loopback port of the capture listener.
 * @returns True once the request is sent.
 */
function sendThroughAgent(agent: Agent, port: number): boolean {
  const req = request({ host: LOOPBACK, port, servername: SNI_HOST, agent });
  req.on('error', (): boolean => true);
  req.end();
  return true;
}

/**
 * Captures the JA4 fingerprint of the ClientHello an HTTPS agent emits.
 * @param agent - Agent under test; its TLS options shape the ClientHello.
 * @returns The JA4 fingerprint of the agent's first handshake.
 */
async function captureJa4(agent: Agent): Promise<string> {
  const server = createServer();
  const connection = acceptOnce(server);
  const port = await listenOnLoopback(server);
  sendThroughAgent(agent, port);
  const socket = await connection;
  const rawHello = await readClientHello(socket);
  server.close();
  return computeJa4(rawHello);
}

export { captureJa4, computeJa4 };
