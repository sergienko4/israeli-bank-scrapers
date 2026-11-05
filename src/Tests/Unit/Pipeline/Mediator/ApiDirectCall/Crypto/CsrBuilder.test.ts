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
import { childrenOf, csrPartsOf, type ITlv, openTestCsr } from '../../../../../Helpers/TestCsr.js';

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
