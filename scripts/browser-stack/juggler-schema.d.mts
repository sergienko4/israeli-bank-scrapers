/**
 * Type declarations for `scripts/browser-stack/juggler-schema.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type their assertions rather than import `any`.
 */

/**
 * One normalized Juggler type. Enum values keep their JS type: Camoufox ships
 * `t.Enum(['mixed', true])`, and Juggler matches values with `indexOf`.
 */
export type SchemaType =
  | { readonly t: 'Boolean' | 'String' | 'Number' | 'Any' }
  | { readonly t: 'Enum'; readonly values: readonly (string | boolean)[] }
  | { readonly t: 'Array'; readonly item: SchemaType }
  | { readonly t: 'Object'; readonly fields: Readonly<Record<string, IField>> }
  | { readonly t: 'Nullable'; readonly inner: SchemaType }
  | { readonly t: 'Ref'; readonly ns: string; readonly name: string };

/** An object field; `t.Optional(<type>)` sets `optional`. */
export interface IField {
  readonly optional: boolean;
  readonly type: SchemaType;
}

/** One method; `params` and `returns` are `{}` when the source omits them. */
export interface IMethod {
  readonly params: Readonly<Record<string, IField>>;
  readonly returns: Readonly<Record<string, IField>>;
}

/** One domain's methods and event payloads. */
export interface IDomain {
  readonly methods: Readonly<Record<string, IMethod>>;
  readonly events: Readonly<Record<string, Readonly<Record<string, IField>>>>;
}

/** Parser output: domains, plus every type namespace (`X` of `X.Name = …`) for Ref resolution. */
export interface NormalizedSchema {
  readonly domains: Readonly<Record<string, IDomain>>;
  readonly namespaces: Readonly<Record<string, Readonly<Record<string, SchemaType>>>>;
}

/** A construct outside the supported grammar, located by its 1-based line (0 when unknown). */
export declare class UnparseableSchemaError extends Error {
  readonly line: number;
  constructor(line: number, reason: string);
}

/**
 * Normalized schema of a Juggler `Protocol.js` source; parsed, never executed.
 *
 * @param text - Source text.
 * @returns Domains and type namespaces.
 * @throws {UnparseableSchemaError} On any construct outside the grammar.
 */
export function parseJugglerSchema(text: string): NormalizedSchema;
