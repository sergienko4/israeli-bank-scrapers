/**
 * Reads the outer signature algorithm of a DER-encoded X.509 certificate.
 *
 * `X509Certificate#signatureAlgorithmOid` exists only on recent Node lines, so
 * the server-certificate floor reads the field itself. The reader walks just
 * the path it needs (Certificate → signatureAlgorithm → OID, plus the
 * RSASSA-PSS hash), bounds-checks every length against its parent, and yields
 * empty OIDs on any malformed input so the caller fails closed.
 */

/** Universal SEQUENCE tag. */
const SEQUENCE = 0x30;

/** Universal OBJECT IDENTIFIER tag. */
const OBJECT_IDENTIFIER = 0x06;

/** Context-specific constructed `[0]` tag (RSASSA-PSS `hashAlgorithm`). */
const CONTEXT_0 = 0xa0;

/** Lowest length byte that announces a long-form length. */
const LONG_FORM = 0x80;

/** Most length bytes accepted; a certificate never needs more than four. */
const MAX_LENGTH_BYTES = 4;

/** Radix of an OID sub-identifier byte. */
const OID_RADIX = 0x80;

/** Arcs folded into an OID's first byte (`first = 40 * arc0 + arc1`). */
const FIRST_BYTE_ARCS = 40;

/** Highest first arc (`joint-iso-itu-t`); larger values belong to arc 2. */
const MAX_FIRST_ARC = 2;

/** A certificate's outer signature algorithm, as dotted OIDs. */
interface ISignatureAlgorithm {
  /** `signatureAlgorithm.algorithm`; empty when the DER is malformed. */
  readonly oid: string;
  /** RSASSA-PSS explicit `hashAlgorithm`; empty when defaulted (SHA-1) or absent. */
  readonly pssHashOid: string;
}

/** A position to read at and the end of the enclosing element. */
interface IDerCursor {
  readonly raw: Buffer;
  readonly offset: number;
  readonly limit: number;
}

/** Content bounds of one decoded element. */
interface IDerNode {
  readonly start: number;
  readonly end: number;
}

/** Sentinel for a missing or malformed element; every read from it fails. */
const NO_NODE: IDerNode = { start: -1, end: -1 };

/** OID accumulator: completed arcs plus the sub-identifier being built. */
interface IOidAccumulator {
  readonly arcs: readonly number[];
  readonly pending: number;
}

/**
 * Decode a DER length field.
 * @param raw - Certificate bytes.
 * @param offset - Offset of the first length byte.
 * @returns Content length and content offset; length is -1 when unsupported.
 */
function readLength(raw: Buffer, offset: number): readonly [length: number, start: number] {
  const first = raw.readUInt8(offset);
  if (first < LONG_FORM) return [first, offset + 1];
  const count = first - LONG_FORM;
  const isUnsupported = count === 0 || count > MAX_LENGTH_BYTES;
  if (isUnsupported || offset + 1 + count > raw.length) return [-1, offset];
  const length = raw.readUIntBE(offset + 1, count);
  return [length, offset + 1 + count];
}

/**
 * Read the element at the cursor when it carries the expected tag.
 * @param cursor - Where to read and the enclosing element's end.
 * @param tag - Required tag byte.
 * @returns The element's content bounds, or NO_NODE.
 */
function readNode(cursor: IDerCursor, tag: number): IDerNode {
  const { raw, offset, limit } = cursor;
  if (offset < 0 || offset + 2 > limit || raw.readUInt8(offset) !== tag) return NO_NODE;
  const [length, start] = readLength(raw, offset + 1);
  const end = start + length;
  if (length < 0 || end > limit) return NO_NODE;
  return { start, end };
}

/**
 * Cursor over an element's content.
 * @param raw - Certificate bytes.
 * @param node - The enclosing element.
 * @returns A cursor at the element's first child.
 */
function contentOf(raw: Buffer, node: IDerNode): IDerCursor {
  return { raw, offset: node.start, limit: node.end };
}

/**
 * Fold one OID byte into the accumulator.
 * @param acc - Arcs so far.
 * @param byte - Next base-128 byte.
 * @returns The updated accumulator.
 */
function appendOidByte(acc: IOidAccumulator, byte: number): IOidAccumulator {
  const pending = acc.pending * OID_RADIX + (byte % OID_RADIX);
  if (byte >= OID_RADIX) return { arcs: acc.arcs, pending };
  return { arcs: [...acc.arcs, pending], pending: 0 };
}

/**
 * Decode an OBJECT IDENTIFIER's content to dotted form.
 * @param raw - Certificate bytes.
 * @param node - The OID element.
 * @returns The dotted OID, or empty when the element is missing.
 */
function decodeOid(raw: Buffer, node: IDerNode): string {
  if (node.end <= node.start) return '';
  const first = raw.readUInt8(node.start);
  const firstQuotient = Math.floor(first / FIRST_BYTE_ARCS);
  const arc0 = Math.min(firstQuotient, MAX_FIRST_ARC);
  const seed: IOidAccumulator = { arcs: [arc0, first - arc0 * FIRST_BYTE_ARCS], pending: 0 };
  const tail = raw.subarray(node.start + 1, node.end);
  const decoded = [...tail].reduce(appendOidByte, seed);
  return decoded.arcs.join('.');
}

/**
 * Read the explicit RSASSA-PSS hash from the algorithm parameters.
 * `RSASSA-PSS-params ::= SEQUENCE { hashAlgorithm [0] AlgorithmIdentifier DEFAULT sha1, … }`
 * @param params - Cursor at the AlgorithmIdentifier parameters.
 * @returns The hash OID, or empty when absent (the SHA-1 default) or not PSS.
 */
function readPssHash(params: IDerCursor): string {
  const { raw } = params;
  const pss = readNode(params, SEQUENCE);
  const pssFields = contentOf(raw, pss);
  const explicit = readNode(pssFields, CONTEXT_0);
  const explicitBody = contentOf(raw, explicit);
  const hashAlgorithm = readNode(explicitBody, SEQUENCE);
  const hashFields = contentOf(raw, hashAlgorithm);
  const hashOid = readNode(hashFields, OBJECT_IDENTIFIER);
  return decodeOid(raw, hashOid);
}

/**
 * Read a certificate's outer signature algorithm.
 * `Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }`
 * @param raw - DER-encoded certificate.
 * @returns The algorithm OIDs; empty OIDs when the DER is malformed.
 */
function readSignatureAlgorithm(raw: Buffer): ISignatureAlgorithm {
  const certificate = readNode({ raw, offset: 0, limit: raw.length }, SEQUENCE);
  const certificateFields = contentOf(raw, certificate);
  const tbs = readNode(certificateFields, SEQUENCE);
  const algorithm = readNode({ raw, offset: tbs.end, limit: certificate.end }, SEQUENCE);
  const algorithmFields = contentOf(raw, algorithm);
  const oid = readNode(algorithmFields, OBJECT_IDENTIFIER);
  const pssHashOid = readPssHash({ raw, offset: oid.end, limit: algorithm.end });
  const algorithmOid = decodeOid(raw, oid);
  return { oid: algorithmOid, pssHashOid };
}

export type { ISignatureAlgorithm };
export { readSignatureAlgorithm };
