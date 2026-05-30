/**
 * SignerTypes — cryptographic-signer concern slice of the
 * API-DIRECT-CALL config contract.
 *
 * Standalone bucket (no dependencies on other ConfigContracts files):
 * carries the closed set of signer-algorithm tags + per-variant
 * configuration shapes consumed by Crypto/ helpers. Higher-level
 * sub-modules (EnvelopeTypes via ICryptoFieldConfig, ApiDirectCallConfig
 * via ISignerConfig) compose from here.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

/** Supported crypto algorithm tags consumed by GenericCryptoSigner. */
type SignerAlgorithm = 'ECDSA-P256' | 'RSA-2048' | 'AES-CBC-PKCS7';

/** Asymmetric subset — discriminator for {@link IAsymmetricSignerConfig}. */
type AsymmetricSignerAlgorithm = 'ECDSA-P256' | 'RSA-2048';

/** Supported signature-encoding tags (DER for legacy, JOSE for modern). */
type SignerEncoding = 'DER' | 'JOSE';

/** Canonical-string parts — ordered by ICanonicalStringConfig.parts. */
type CanonicalPart = 'pathAndQuery' | 'clientVersion' | 'bodyJson' | 'tsMs' | 'deviceId';

/** Canonical-string assembly config — consumed by GenericCanonicalStringBuilder. */
interface ICanonicalStringConfig {
  readonly parts: readonly CanonicalPart[];
  readonly separator: string;
  readonly escapeFrom: string;
  readonly escapeTo: string;
  readonly sortQueryParams: boolean;
  readonly clientVersion: string;
}

/**
 * Asymmetric (ECDSA / RSA) signer variant — header-attached signature.
 *
 * Existing banks (Pepper, OneZero) use this shape: the signature is
 * computed over a canonical string + attached as a header value
 * `data:<b64>;key-id:<hex>;scheme:<n>`.
 */
interface IAsymmetricSignerConfig {
  readonly algorithm: AsymmetricSignerAlgorithm;
  readonly encoding: SignerEncoding;
  readonly headerName: string;
  readonly schemeTag: number;
  readonly canonical: ICanonicalStringConfig;
}

/**
 * Symmetric AES-CBC-PKCS7 signer variant — body-pointer-attached
 * signature. The signature is written into the outgoing JSON body at
 * a configured RFC-6901 pointer (`/signature` for class-z; `/auth/signature`
 * for class-y post-login envelopes). The optional postfix lets banks
 * whose servers expect a trailing newline append one.
 *
 * `ivCarrySlot` names the carry slot the runner overwrites with a
 * fresh 16-byte random hex string at each step entry; the body
 * template references the same slot via `$ref: 'carry.<slot>'` so the
 * hydrated body and the signer observe the same IV bytes.
 */
interface IAesSignerConfig {
  readonly algorithm: 'AES-CBC-PKCS7';
  readonly keyRef: `config.${string}`;
  readonly ivStrategy: 'random-16';
  readonly ivCarrySlot: string;
  readonly canonical: ICanonicalStringConfig;
  readonly bodySignatureField: string;
  readonly bodyIvField?: string;
  readonly outputPostfix?: string;
}

/** Bank crypto configuration — discriminated by `algorithm`. */
type ISignerConfig = IAsymmetricSignerConfig | IAesSignerConfig;

/**
 * Optional crypto-field config — after the preHook deposits a creds
 * value into carry, encrypt it via the bank's AES primitive and write
 * the ciphertext into the outgoing body at a JSON pointer, then scrub
 * the plaintext from carry. Used by PIN / OTP-encrypting banks whose
 * login flow encrypts a PIN / OTP into a body pointer separately from
 * the request-body signature.
 */
interface ICryptoFieldConfig {
  /**
   * Key reference — resolved against `config.<dotted.path>` or
   * `carry.<slot>`. The resulting key bytes are a step-time artifact.
   */
  readonly keyRef: `config.${string}` | `carry.${string}`;
  /** IV reference — typically a 32-hex carry slot like `carry.pinIv1Hex`. */
  readonly ivRef: `carry.${string}`;
  /** Optional trailing-postfix string (e.g. `\n` when the server demands one). */
  readonly outputPostfix?: string;
  /** RFC-6901 pointer into the outbound body (e.g. `/pin`). */
  readonly writeTo: string;
  /** Name of the carry slot to redact post-encryption. */
  readonly scrubFromCarry: string;
}

export type {
  AsymmetricSignerAlgorithm,
  CanonicalPart,
  IAesSignerConfig,
  IAsymmetricSignerConfig,
  ICanonicalStringConfig,
  ICryptoFieldConfig,
  ISignerConfig,
  SignerAlgorithm,
  SignerEncoding,
};
