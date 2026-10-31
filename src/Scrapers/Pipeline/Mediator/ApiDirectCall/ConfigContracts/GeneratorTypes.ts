/**
 * GeneratorTypes — step carry generators (N25). A generator runs once its
 * step's `runIf` guard passes and before the step's body is hydrated, and
 * writes what it makes into carry slots for the body and later steps.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

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

/** One step carry generator, dispatched by `kind`. */
type ICarryGenerator = IRsaKeyGenerator;

/** The generator kinds. */
type CarryGeneratorKind = ICarryGenerator['kind'];

export type { CarryGeneratorKind, ICarryGenerator, IRsaKeyGenerator };
