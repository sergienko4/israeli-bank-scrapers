/**
 * TemplateTypes — substrate of the API-DIRECT-CALL config contract.
 *
 * Bucket-0 of the Phase 8 split: defines the template-language
 * primitives (interpolation tokens, value templates, selectors) that
 * the higher-level sub-modules (Carry, Envelope, Flow, ApiDirectCallConfig)
 * compose without circular dependencies. No imports from other
 * ConfigContracts files — rubber-duck F4 fix.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

/**
 * RefToken — interpolation tokens in IBodyTemplate. `cookie.<name>` reads a
 * jar cookie, URL-decoded, for the step URL (N12).
 */
type RefToken =
  | 'fingerprint'
  | 'uuid'
  | 'now'
  | 'nowMs'
  | 'keypair.ec.publicKeyBase64'
  | 'keypair.rsa.publicKeyBase64'
  | `carry.${string}`
  | `creds.${string}`
  | `config.${string}`
  | `cookie.${string}`;

/** One `$join` part (N24) — a ref token, or literal text between refs. */
type JoinPart = RefToken | { readonly literal: string };

/** How a `$join` encodes its concatenated text — base64 over UTF-8. */
type JoinEncoding = 'base64';

/**
 * A `$join` node (N24) — hydrates to `prefix` + the parts concatenated,
 * base64 over UTF-8 when `encode` is set. Computed per hydration, never
 * stored in carry.
 */
interface IJoinTemplate {
  readonly parts: readonly JoinPart[];
  readonly encode?: JoinEncoding;
  readonly prefix?: string;
}

/** Named selector map — values are RFC-6901 pointers like `/data/challenge`. */
type IEnvelopeSelectors = Readonly<Record<string, string>>;

/**
 * Recursive body template — JsonValueTemplate with $literal / $ref / $join nodes,
 * heterogeneous arrays, and recursive object maps. The object arm admits
 * `undefined` values because TS-widened heterogeneous unions of the form
 * `{a:X, b?: undefined} | {a?: undefined, b:Y}` (e.g. Pepper headers list)
 * carry undefined for the alternate arm. At runtime the literal objects
 * never carry undefined values — `Object.entries` only enumerates own
 * keys actually present.
 */
type JsonValueTemplate =
  | { readonly $literal: unknown }
  | { readonly $ref: RefToken }
  | { readonly $join: IJoinTemplate }
  | readonly JsonValueTemplate[]
  | { readonly [key: string]: JsonValueTemplate | undefined };

/** Body template wrapper — shape is recursive JsonValueTemplate. */
interface IBodyTemplate {
  readonly shape: JsonValueTemplate;
}

export type {
  IBodyTemplate,
  IEnvelopeSelectors,
  IJoinTemplate,
  JoinEncoding,
  JoinPart,
  JsonValueTemplate,
  RefToken,
};
