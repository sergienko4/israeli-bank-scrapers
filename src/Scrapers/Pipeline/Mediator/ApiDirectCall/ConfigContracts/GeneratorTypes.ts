/**
 * GeneratorTypes — step carry generators (N25). A generator runs once its
 * step's `runIf` guard passes and before the step's body is hydrated, and
 * writes what it makes into carry slots for the body and later steps.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

import type { JsonValueTemplate, RefToken } from './TemplateTypes.js';

/** N25a — a fresh RSA key pair for one run of the step. */
interface IRsaKeyGenerator {
  readonly kind: 'rsa-key';
  /** Modulus length in bits. */
  readonly bits: 2048;
  /** Carry slot for the PKCS#8 PEM private key. */
  readonly keyInto?: string;
  /** Carry slot for the lowercase hex SHA-256 of the public key's SPKI DER. */
  readonly spkiSha256HexInto?: string;
}

/** A CSR subject attribute: organization, domain component, unit, common name. */
type CsrSubjectAttr = 'O' | 'DC' | 'OU' | 'CN';

/** One subject RDN; its value hydrates like a body value and must be text. */
interface ICsrSubjectEntry {
  readonly attr: CsrSubjectAttr;
  readonly value: JsonValueTemplate;
}

/** N25b — a PKCS#10 request signed SHA1withRSA, base64url DER into carry. */
interface IPkcs10CsrGenerator {
  readonly kind: 'pkcs10-csr';
  /** Ref to the PKCS#8 PEM RSA private key that signs the request. */
  readonly keyRef: RefToken;
  /** Subject RDNs, in order. */
  readonly subject: readonly ICsrSubjectEntry[];
  /** Carry slot for the base64url DER request. */
  readonly into: string;
}

/** N38 — a fresh ECDH key pair for one run of the step. */
interface IEcdhKeyGenerator {
  readonly kind: 'ecdh-key';
  /** Named curve. */
  readonly curve: 'secp256k1';
  /** Carry slot for the base64 uncompressed public point (65 bytes, 0x04 first). */
  readonly publicInto: string;
  /** Carry slot for the base64 32-byte private scalar; never a `sessionCarry` slot. */
  readonly privateInto: string;
}

/** One step carry generator, dispatched by `kind`. */
type ICarryGenerator = IRsaKeyGenerator | IPkcs10CsrGenerator | IEcdhKeyGenerator;

/** The generator kinds. */
type CarryGeneratorKind = ICarryGenerator['kind'];

export type {
  CarryGeneratorKind,
  CsrSubjectAttr,
  ICarryGenerator,
  ICsrSubjectEntry,
  IEcdhKeyGenerator,
  IPkcs10CsrGenerator,
  IRsaKeyGenerator,
};
