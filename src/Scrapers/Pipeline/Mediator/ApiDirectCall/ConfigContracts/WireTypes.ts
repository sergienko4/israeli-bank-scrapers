/**
 * WireTypes — the wire-reading concern slice of the API-DIRECT-CALL config
 * contract: what a step captures from a `text` answer (N36 text captures,
 * N37 login-form capture) and how a POST step's body and answer are
 * enveloped (N39 envelope codec).
 *
 * A root bucket: no intra-cluster deps. FlowTypes references these from
 * `IStepBase` and `IPostStep`.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

/**
 * One text capture (N36) on a `text` step: its pattern must match the answer
 * exactly once, and the slot takes the text of `group`. An `absent` capture is
 * a guard instead: its pattern must not match, and it carries nothing.
 */
interface ITextCapture {
  /** Regex source, searched in the whole answer with the `g` flag. */
  readonly pattern: string;
  /** Group whose text the slot takes; 0 is the whole match. */
  readonly group: number;
  /** Makes the capture a guard: the pattern must not match. */
  readonly absent?: true;
}

/**
 * A login-form capture (N37) on a `text` step: the page's one `<form>` whose
 * `id` or `name` is `form` must post to `action`, and its hidden fields go to
 * carry `into` as one `{ name: value }` record, in page order.
 */
interface IFormCapture {
  /** The form's `id` or `name`, compared exactly. */
  readonly form: string;
  /** Carry slot the field record goes to. */
  readonly into: string;
  /** Absolute URL the form's action must resolve to, against the step URL. */
  readonly action: string;
  /** Field names the form must hold. */
  readonly required: readonly string[];
  /** Field names the form must not hold. */
  readonly forbidden: readonly string[];
  /** Fewest fields the form may hold. */
  readonly minFields: number;
  /** Most fields the form may hold. */
  readonly maxFields: number;
}

/**
 * The `sealed` mode of the AES-CBC envelope codec (N39): the step's hydrated
 * `{ headers, data }` body goes out sealed under the session key, and its
 * answer must come back sealed for the same session (N52).
 */
interface IEnvelopeSealed {
  readonly kind: 'ecdh-aes-cbc';
  readonly mode: 'sealed';
  /** Carry ref of the session key: canonical base64 of 32 bytes. */
  readonly keyRef: `carry.${string}`;
  /** Carry ref of the crypto session id: 1..512 characters. */
  readonly sessionRef: `carry.${string}`;
}

/**
 * The `exchange` mode of the AES-CBC envelope codec (N39): the step's body goes
 * out as hydrated, and the session comes from the answer's `key_exchange`
 * header and the carried client scalar; the answer must come back sealed
 * under it (N52), and the key and id go to carry for the sealed steps.
 */
interface IEnvelopeExchange {
  readonly kind: 'ecdh-aes-cbc';
  readonly mode: 'exchange';
  /** Carry ref of the client's secp256k1 private scalar: canonical base64 of 32 bytes. */
  readonly privateRef: `carry.${string}`;
  /** Carry slot that receives the session key, base64. */
  readonly keyInto: string;
  /** Carry slot that receives the crypto session id. */
  readonly sessionInto: string;
}

/** How a POST step's request and answer are enveloped (N39). */
type EnvelopeCodec = IEnvelopeExchange | IEnvelopeSealed;

export type { EnvelopeCodec, IEnvelopeExchange, IEnvelopeSealed, IFormCapture, ITextCapture };
