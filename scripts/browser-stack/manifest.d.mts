/**
 * Type declarations for `scripts/browser-stack/manifest.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive its pure core need this to type their assertions rather than
 * import `any`.
 */

/** One contract violation, located by RFC 6901 JSON pointer (`''` = root). */
export interface ManifestIssue {
  readonly pointer: string;
  readonly reason: string;
}

/** Juggler message direction a delta was found on. */
export declare const DELTA_CHANNELS: readonly ['request', 'return', 'event'];

/** Every delta kind the directional differ reports. */
export declare const DELTA_KINDS: readonly [
  'MISSING-METHOD',
  'MISSING-EVENT',
  'UNKNOWN-FIELD',
  'MISSING-REQUIRED-FIELD',
  'ENUM-VALUE',
  'NULLABLE',
  'TYPE-MISMATCH',
];

/**
 * Every way a parsed document breaks the manifest contract.
 *
 * @param doc - Parsed `browser-stack.json`.
 * @returns Shape, then field, then per-delta findings; empty when valid.
 */
export function validateManifest(doc: unknown): ManifestIssue[];

/**
 * Read and validate a manifest file.
 *
 * @param file - Path to `browser-stack.json`.
 * @returns The manifest only when it is fully valid, plus every finding.
 */
export function loadManifest(file: string): {
  readonly manifest?: { readonly camoufox: { readonly tag: string } };
  readonly issues: ManifestIssue[];
};
