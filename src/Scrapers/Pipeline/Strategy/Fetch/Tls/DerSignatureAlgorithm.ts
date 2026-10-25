/**
 * Reads the outer signature algorithm of a DER-encoded X.509 certificate.
 *
 * `X509Certificate#signatureAlgorithmOid` exists only on recent Node lines, so
 * the server-certificate floor reads the field itself. The reader walks just
 * the path it needs (Certificate → signatureAlgorithm → OID, plus the
 * RSASSA-PSS hash), bounds-checks every length against its parent, and yields
 * empty OIDs on any malformed input — including an OID with a padded,
 * unterminated or oversized sub-identifier — so the caller fails closed.
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

/** Radix of an OID sub-identifier byte; bytes at or above it continue the value. */
const OID_RADIX = 0x80;

/** Largest sub-identifier decoded exactly; anything larger is malformed here. */
const MAX_SUBIDENTIFIER = Number.MAX_SAFE_INTEGER;

/** Arcs under roots 0 and 1; the first sub-identifier is `40 * arc0 + arc1`. */
const SECOND_ARC_SPAN = 40;

/** Highest root arc (`joint-iso-itu-t`), which takes every larger value. */
const MAX_ROOT_ARC = 2;

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

/** OID accumulator: completed sub-identifiers plus the one being built. */
interface IOidAccumulator {
  readonly values: readonly number[];
  readonly pending: number;
  readonly isWellFormed: boolean;
}

/** Accumulator before the first OID byte. */
const OID_SEED: IOidAccumulator = { values: [], pending: 0, isWellFormed: true };

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
 * Fold one OID byte into the accumulator. A sub-identifier that opens with a
 * zero continuation byte is padded (not minimal DER), and one past
 * MAX_SUBIDENTIFIER cannot be decoded exactly; either marks the OID malformed.
 * @param acc - Sub-identifiers so far.
 * @param byte - Next base-128 byte.
 * @returns The updated accumulator.
 */
function appendOidByte(acc: IOidAccumulator, byte: number): IOidAccumulator {
  const isPadding = acc.pending === 0 && byte === OID_RADIX;
  const pending = acc.pending * OID_RADIX + (byte % OID_RADIX);
  const isWellFormed = acc.isWellFormed && !isPadding && pending <= MAX_SUBIDENTIFIER;
  if (byte >= OID_RADIX) return { values: acc.values, pending, isWellFormed };
  return { values: [...acc.values, pending], pending: 0, isWellFormed };
}

/**
 * Split the first sub-identifier into the root arc and the second arc.
 * @param values - Decoded sub-identifiers, at least one.
 * @returns The OID's arcs.
 */
function splitRootArc(values: readonly number[]): readonly number[] {
  const [combined = 0, ...rest] = values;
  const quotient = Math.floor(combined / SECOND_ARC_SPAN);
  const root = Math.min(quotient, MAX_ROOT_ARC);
  return [root, combined - root * SECOND_ARC_SPAN, ...rest];
}

/**
 * Decode an OBJECT IDENTIFIER's content to dotted form.
 * @param raw - Certificate bytes.
 * @param node - The OID element.
 * @returns The dotted OID; empty when the element is missing or malformed.
 */
function decodeOid(raw: Buffer, node: IDerNode): string {
  if (node.end <= node.start) return '';
  const content = raw.subarray(node.start, node.end);
  const decoded = [...content].reduce(appendOidByte, OID_SEED);
  if (!decoded.isWellFormed || decoded.pending !== 0) return '';
  const arcs = splitRootArc(decoded.values);
  return arcs.join('.');
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
