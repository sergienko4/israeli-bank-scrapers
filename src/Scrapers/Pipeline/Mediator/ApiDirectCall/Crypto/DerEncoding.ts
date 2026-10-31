/**
 * DerEncoding — the few DER writers the PKCS#10 builder needs (N25b):
 * definite-length nodes, sequences and sets. Lengths below 128 use the short
 * form; longer bodies the long form with the fewest length octets.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

/** DER tags the CSR builder writes. */
const DER_TAGS = {
  bitString: 0x03,
  objectId: 0x06,
  utf8String: 0x0c,
  printableString: 0x13,
  ia5String: 0x16,
  sequence: 0x30,
  set: 0x31,
  contextZero: 0xa0,
} as const;

/** One DER tag. */
type DerTag = (typeof DER_TAGS)[keyof typeof DER_TAGS];

/** Bodies shorter than this use the one-octet short length form. */
const SHORT_FORM_LIMIT = 0x80;

/**
 * The big-endian octets of a length, fewest first-octet-non-zero.
 * @param size - Body length (≥ 128).
 * @returns Length octets.
 */
function lengthOctets(size: number): Buffer {
  const hex = size.toString(16);
  const even = hex.padStart(hex.length + (hex.length % 2), '0');
  return Buffer.from(even, 'hex');
}

/**
 * The DER length field of a body.
 * @param size - Body length.
 * @returns Short form below 128, else long form.
 */
function derLength(size: number): Buffer {
  if (size < SHORT_FORM_LIMIT) return Buffer.of(size);
  const octets = lengthOctets(size);
  const head = Buffer.of(SHORT_FORM_LIMIT + octets.length);
  return Buffer.concat([head, octets]);
}

/**
 * One DER node.
 * @param tag - Node tag.
 * @param body - Node body.
 * @returns Tag, length and body.
 */
function derNode(tag: DerTag, body: Buffer): Buffer {
  const head = Buffer.of(tag);
  const length = derLength(body.length);
  return Buffer.concat([head, length, body]);
}

/**
 * A SEQUENCE of the given encoded parts, in order.
 * @param parts - Encoded children.
 * @returns SEQUENCE node.
 */
function derSequence(parts: readonly Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return derNode(DER_TAGS.sequence, body);
}

export type { DerTag };
export { DER_TAGS, derNode, derSequence };
