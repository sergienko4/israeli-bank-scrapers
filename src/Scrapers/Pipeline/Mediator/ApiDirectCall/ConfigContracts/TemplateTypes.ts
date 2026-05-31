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

/** RefToken — interpolation tokens in IBodyTemplate. */
type RefToken =
  | 'fingerprint'
  | 'uuid'
  | 'now'
  | 'nowMs'
  | 'keypair.ec.publicKeyBase64'
  | 'keypair.rsa.publicKeyBase64'
  | `carry.${string}`
  | `creds.${string}`
  | `config.${string}`;

/** Named selector map — values are RFC-6901 pointers like `/data/challenge`. */
type IEnvelopeSelectors = Readonly<Record<string, string>>;

/**
 * Recursive body template — JsonValueTemplate with $literal / $ref nodes,
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
  | readonly JsonValueTemplate[]
  | { readonly [key: string]: JsonValueTemplate | undefined };

/** Body template wrapper — shape is recursive JsonValueTemplate. */
interface IBodyTemplate {
  readonly shape: JsonValueTemplate;
}

export type { IBodyTemplate, IEnvelopeSelectors, JsonValueTemplate, RefToken };
