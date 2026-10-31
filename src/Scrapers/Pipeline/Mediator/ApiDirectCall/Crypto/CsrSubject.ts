/**
 * CsrSubject — the subject Name of a PKCS#10 request (N25b): one RDN per
 * entry, in the given order. DC is an IA5String and must be ASCII; O, OU
 * and CN are a PrintableString when the text allows it, else a UTF8String.
 *
 * Zero bank knowledge. Rule #11 compliant.
 */

import type { CsrSubjectAttr } from '../ConfigContracts/index.js';
import { DER_TAGS, derNode, derSequence, type DerTag } from './DerEncoding.js';

/** One subject RDN with its hydrated text. */
interface ICsrSubjectValue {
  readonly attr: CsrSubjectAttr;
  readonly value: string;
}

/** A string node's tag and bytes. */
interface IDerText {
  readonly tag: DerTag;
  readonly bytes: Buffer;
}

/** Picks the string type for one attribute; false when the text cannot be one. */
type TextEncoder = (value: string) => IDerText | false;

/** OID bodies: O 2.5.4.10, OU 2.5.4.11, CN 2.5.4.3, DC 0.9.2342.19200300.100.1.25. */
const SUBJECT_OIDS: Readonly<Record<CsrSubjectAttr, string>> = {
  O: '55040a',
  OU: '55040b',
  CN: '550403',
  DC: '0992268993f22c640119',
};

/** The PrintableString alphabet. */
const PRINTABLE_TEXT = /^[\d '()+,./:=?a-z-]*$/i;

/**
 * A directory string: PrintableString when the text allows it, else UTF8String.
 * @param value - Attribute text.
 * @returns Tag and UTF-8 bytes.
 */
function directoryText(value: string): IDerText {
  const isPrintable = PRINTABLE_TEXT.test(value);
  const tag = isPrintable ? DER_TAGS.printableString : DER_TAGS.utf8String;
  const bytes = Buffer.from(value, 'utf8');
  return { tag, bytes };
}

/**
 * An IA5String; ASCII text only (each character one UTF-8 byte).
 * @param value - Attribute text.
 * @returns Tag and bytes, or false for non-ASCII text.
 */
function ia5Text(value: string): IDerText | false {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length !== value.length) return false;
  return { tag: DER_TAGS.ia5String, bytes };
}

/** The string type of each attribute. */
const TEXT_ENCODERS: Readonly<Record<CsrSubjectAttr, TextEncoder>> = {
  O: directoryText,
  OU: directoryText,
  CN: directoryText,
  DC: ia5Text,
};

/**
 * One RDN: SET { SEQUENCE { OID, string } }.
 * @param entry - Attribute and text.
 * @returns RDN DER, or false when the text cannot be encoded.
 */
function rdnDer(entry: ICsrSubjectValue): Buffer | false {
  const text = TEXT_ENCODERS[entry.attr](entry.value);
  if (text === false) return false;
  const oidBody = Buffer.from(SUBJECT_OIDS[entry.attr], 'hex');
  const oid = derNode(DER_TAGS.objectId, oidBody);
  const value = derNode(text.tag, text.bytes);
  const pair = derSequence([oid, value]);
  return derNode(DER_TAGS.set, pair);
}

/**
 * Whether an RDN was encoded.
 * @param rdn - RDN DER or false.
 * @returns True for DER.
 */
function isEncoded(rdn: Buffer | false): rdn is Buffer {
  return rdn !== false;
}

/**
 * The subject Name, RDNs in the given order.
 * @param subject - Subject entries.
 * @returns Name DER, or false when any text cannot be encoded.
 */
function csrSubjectDer(subject: readonly ICsrSubjectValue[]): Buffer | false {
  const rdns = subject.map(rdnDer);
  const encoded = rdns.filter(isEncoded);
  if (encoded.length !== rdns.length) return false;
  return derSequence(encoded);
}

export type { ICsrSubjectValue };
export { csrSubjectDer };
