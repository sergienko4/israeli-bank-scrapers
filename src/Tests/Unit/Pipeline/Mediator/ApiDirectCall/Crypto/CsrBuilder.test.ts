/**
 * N25b — the PKCS#10 builder behind the `pkcs10-csr` generator. Subject RDNs
 * keep their order; DC is an IA5String, other attributes a PrintableString
 * when the text allows it and a UTF8String otherwise. The request is v0,
 * signed SHA1withRSA over the CertificationRequestInfo, with an empty
 * attribute set, and returned as base64url DER without padding.
 */

import { generateKeyPairSync, type KeyObject, verify } from 'node:crypto';

import {
  buildCsr,
  type ICsrBuildInput,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CsrBuilder.js';
import {
  csrSubjectDer,
  type ICsrSubjectValue,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/CsrSubject.js';
import { childrenOf, csrPartsOf, type ITlv, openTestCsr, readTlv } from '../../../../../Helpers/TestCsr.js';

/** Subject goldens: O, DC, OU, CN DER from the reference CSR builder. */
const SUBJECT_GOLDENS = {
  ascii:
    '3081a031133011060355040a130a42616e6b20596168617631233021060a0992268993f22c640119161349737261656c6942616e6b536372617065727331493047060355040b13406162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616231193017060355040313103132333435362d303132333435363738',
  utf8Org:
    '3081a331163014060355040a0c0dd791d7a0d7a720d799d794d79131233021060a0992268993f22c640119161349737261656c6942616e6b536372617065727331493047060355040b13406162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616231193017060355040313103132333435362d303132333435363738',
  dcStrip:
    '30819831133011060355040a130a42616e6b205961686176311b3019060a0992268993f22c640119160b4d79504330316c6f63616c31493047060355040b13406162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616231193017060355040313103132333435362d303132333435363738',
  dcEmpty:
    '30819631133011060355040a130a42616e6b20596168617631193017060a0992268993f22c6401191609556e646566696e656431493047060355040b13406162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616261626162616231193017060355040313103132333435362d303132333435363738',
} as const;

const SHA1_WITH_RSA_HEX = '300d06092a864886f70d0101050500';

/**
 * The golden subject with the given organization and DC texts.
 * @param organization - O text.
 * @param dc - DC text.
 * @returns Subject in O, DC, OU, CN order.
 */
function subjectOf(organization: string, dc: string): readonly ICsrSubjectValue[] {
  return [
    { attr: 'O', value: organization },
    { attr: 'DC', value: dc },
    { attr: 'OU', value: 'ab'.repeat(32) },
    { attr: 'CN', value: '123456-012345678' },
  ];
}

const ASCII_SUBJECT = subjectOf('Bank Yahav', 'IsraeliBankScrapers');

/**
 * Split a base64url CSR into its three top-level parts.
 * @param csr - base64url DER.
 * @returns Request info, algorithm and signature bit string.
 */
function partsOf(csr: string): readonly ITlv[] {
  const parts = csrPartsOf(csr);
  expect(parts).toHaveLength(3);
  return parts;
}

describe('csrSubjectDer (N25b)', () => {
  it.each<[keyof typeof SUBJECT_GOLDENS, string, string]>([
    ['ascii', 'Bank Yahav', 'IsraeliBankScrapers'],
    ['utf8Org', 'בנק יהב', 'IsraeliBankScrapers'],
    ['dcStrip', 'Bank Yahav', 'MyPC01local'],
    ['dcEmpty', 'Bank Yahav', 'Undefined'],
  ])('encodes the %s subject to its golden', (golden, organization, dc) => {
    const subject = subjectOf(organization, dc);
    const der = csrSubjectDer(subject);
    if (der === false) throw new TypeError('subject refused');
    const hex = der.toString('hex');
    expect(hex).toBe(SUBJECT_GOLDENS[golden]);
  });

  it('refuses a DC that is not ASCII', () => {
    const subject = subjectOf('Bank Yahav', 'מחשב');
    const der = csrSubjectDer(subject);
    expect(der).toBe(false);
  });
});

describe('buildCsr (N25b)', () => {
  let keyPem = '';
  let publicKey: KeyObject;

  beforeAll((): void => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    keyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    publicKey = pair.publicKey;
  });

  /**
   * Build a CSR for the ASCII subject with the test key.
   * @returns base64url CSR.
   */
  function asciiCsr(): string {
    const input: ICsrBuildInput = { keyPem, subject: ASCII_SUBJECT };
    const csr = buildCsr(input);
    if (csr === false) throw new TypeError('csr refused');
    return csr;
  }

  it('returns base64url DER without padding', () => {
    const csr = asciiCsr();
    expect(csr).toMatch(/^[\w-]+$/);
  });

  it('writes a v0 request info with the subject, the SPKI and empty attributes', () => {
    const csr = asciiCsr();
    const [info] = partsOf(csr);
    const [version, subject, spki, attributes] = childrenOf(info.body);
    const versionHex = version.whole.toString('hex');
    expect(versionHex).toBe('020100');
    const subjectHex = subject.whole.toString('hex');
    expect(subjectHex).toBe(SUBJECT_GOLDENS.ascii);
    const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
    const isSameKey = spki.whole.equals(spkiDer);
    expect(isSameKey).toBe(true);
    const attributesHex = attributes.whole.toString('hex');
    expect(attributesHex).toBe('a000');
  });

  it('signs the request info SHA1withRSA with the given key', () => {
    const csr = asciiCsr();
    const [info, algorithm, signature] = partsOf(csr);
    const algorithmHex = algorithm.whole.toString('hex');
    expect(algorithmHex).toBe(SHA1_WITH_RSA_HEX);
    expect(signature.tag).toBe(0x03);
    expect(signature.body[0]).toBe(0);
    const signed = signature.body.subarray(1);
    const isValid = verify('RSA-SHA1', info.whole, publicKey, signed);
    expect(isValid).toBe(true);
  });

  it('rejects a CSR whose declared length exceeds its bytes', () => {
    const csr = asciiCsr();
    const der = Buffer.from(csr, 'base64url');
    const length = der.readUInt8(2);
    der.writeUInt8(length + 1, 2);
    const malformedCsr = der.toString('base64url');
    const parsedCsr = openTestCsr(malformedCsr);
    expect(parsedCsr).toBe(false);
  });

  it('refuses text that is not a private key', () => {
    const csr = buildCsr({ keyPem: 'not a key', subject: ASCII_SUBJECT });
    expect(csr).toBe(false);
  });

  it('refuses a key that is not RSA', () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const ecPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    const csr = buildCsr({ keyPem: ecPem, subject: ASCII_SUBJECT });
    expect(csr).toBe(false);
  });

  it('refuses a subject it cannot encode', () => {
    const subject = subjectOf('Bank Yahav', 'מחשב');
    const csr = buildCsr({ keyPem, subject });
    expect(csr).toBe(false);
  });
});

describe('buildCsr — extended subject and profile', () => {
  let keyPem = '';
  let publicKey: KeyObject;

  beforeAll((): void => {
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    keyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    publicKey = pair.publicKey;
  });

  /** The subject an app-registration CSR sends, in wire order. */
  const appSubject: readonly ICsrSubjectValue[] = [
    { attr: 'UID', value: 'guid-0123456789' },
    { attr: 'CN', value: 'device-0123456789' },
    { attr: 'C', value: 'IL' },
    { attr: 'ST', value: 'Tel Aviv' },
    { attr: 'L', value: 'TA' },
    { attr: 'O', value: 'Bank Hapoalim' },
  ];

  /** Expected subject OID body hex and text, in wire order. */
  const expectedSubject: readonly (readonly [string, string])[] = [
    ['0992268993f22c640101', 'guid-0123456789'],
    ['550403', 'device-0123456789'],
    ['550406', 'IL'],
    ['550408', 'Tel Aviv'],
    ['550407', 'TA'],
    ['55040a', 'Bank Hapoalim'],
  ];

  /**
   * Build the extended-profile request.
   * @returns Base64-of-PEM request.
   */
  function extendedCsr(): string {
    const csr = buildCsr({
      keyPem,
      subject: appSubject,
      signature: 'sha256',
      wireForm: 'base64-pem',
      extensions: [{ oid: '2.5.29.19', critical: true, valueHex: '30030101ff' }],
    });
    if (csr === false) throw new TypeError('csr refused');
    return csr;
  }

  /**
   * The PEM text an extended CSR carries.
   * @returns Decoded PEM text.
   */
  function pemText(): string {
    const csr = extendedCsr();
    const bytes = Buffer.from(csr, 'base64');
    return bytes.toString('utf8');
  }

  /**
   * The DER bytes the PEM text carries.
   * @returns Request DER.
   */
  function derOfPem(): Buffer {
    const body = pemText()
      .replace('-----BEGIN CERTIFICATE REQUEST-----', '')
      .replace('-----END CERTIFICATE REQUEST-----', '')
      .replaceAll('\n', '')
      .trim();
    return Buffer.from(body, 'base64');
  }

  it('keeps the UID, CN, C, ST, L, O subject order and their string types', () => {
    const der = derOfPem();
    const outer = readTlv(der, 0);
    const [info] = childrenOf(outer.body);
    const [, subject] = childrenOf(info.body);
    const rdns = childrenOf(subject.body);
    expect(rdns).toHaveLength(expectedSubject.length);
    const actual = rdns.map((rdn): readonly [string, string] => {
      const [pair] = childrenOf(rdn.body);
      const [oid, value] = childrenOf(pair.body);
      return [oid.body.toString('hex'), value.body.toString('utf8')];
    });
    expect(actual).toEqual(expectedSubject);
  });

  it('signs SHA256withRSA and carries one critical extensionRequest extension', () => {
    const der = derOfPem();
    const outer = readTlv(der, 0);
    const [info, algorithm, signature] = childrenOf(outer.body);
    const algorithmHex = algorithm.whole.toString('hex');
    expect(algorithmHex).toBe('300d06092a864886f70d01010b0500');
    const [, , , attributes] = childrenOf(info.body);
    expect(attributes.tag).toBe(0xa0);
    const [attribute] = childrenOf(attributes.body);
    const [type, values] = childrenOf(attribute.body);
    const typeHex = type.body.toString('hex');
    expect(typeHex).toBe('2a864886f70d01090e');
    const [extensions] = childrenOf(values.body);
    const [extension] = childrenOf(extensions.body);
    const [extOid, critical, extValue] = childrenOf(extension.body);
    const extOidHex = extOid.body.toString('hex');
    const criticalHex = critical.whole.toString('hex');
    const extValueHex = extValue.body.toString('hex');
    expect(extOidHex).toBe('551d13');
    expect(criticalHex).toBe('0101ff');
    expect(extValueHex).toBe('30030101ff');
    const signed = signature.body.subarray(1);
    const isValid = verify('RSA-SHA256', info.whole, publicKey, signed);
    expect(isValid).toBe(true);
  });

  it('wraps the DER as PEM before the outer Base64', () => {
    const text = pemText();
    const hasHeader = text.startsWith('-----BEGIN CERTIFICATE REQUEST-----\n');
    const hasFooter = text.endsWith('-----END CERTIFICATE REQUEST-----\n');
    expect(hasHeader).toBe(true);
    expect(hasFooter).toBe(true);
    const lines = text.trimEnd().split('\n');
    const isShort = lines.slice(1, -1).every(line => line.length <= 64);
    expect(isShort).toBe(true);
  });

  it('refuses a malformed extension OID or value', () => {
    const badOid = buildCsr({
      keyPem,
      subject: appSubject,
      extensions: [{ oid: 'not.an.oid', critical: true, valueHex: '30030101ff' }],
    });
    expect(badOid).toBe(false);
    const badValue = buildCsr({
      keyPem,
      subject: appSubject,
      extensions: [{ oid: '2.5.29.19', critical: true, valueHex: '0g0' }],
    });
    expect(badValue).toBe(false);
  });
});
