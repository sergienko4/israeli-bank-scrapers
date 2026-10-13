/**
 * Type declarations for `scripts/browser-stack/gen-config.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type their assertions rather than import `any`.
 */
import type { IValidManifest } from './manifest.d.mts';

/** Repo-relative path of the generated module. */
export declare const GENERATED_REL: string;

/** Absolute path of the committed generated module. */
export declare const GENERATED_PATH: string;

/** Paths and sinks of one `generate` run; tests override any member. */
export interface IGenerateIo {
  readonly manifestPath?: string;
  readonly generatedPath?: string;
  readonly stdout?: (text: string) => unknown;
  readonly stderr?: (text: string) => unknown;
}

/**
 * Source of the generated module.
 *
 * @param manifest - Valid manifest.
 * @returns TypeScript source ending in a newline.
 */
export function renderConfig(manifest: IValidManifest): string;

/**
 * Whether the file at `path` differs from the render of `manifest`.
 *
 * @param manifest - Valid manifest.
 * @param path - Path of the generated module; a missing file is stale.
 * @returns True when regeneration would change the file.
 */
export function isGeneratedStale(manifest: IValidManifest, path: string): boolean;

/**
 * Write the module when it is stale.
 *
 * @param overrides - Test paths and sinks.
 * @returns 0 written or current; 2 invalid manifest.
 */
export function generate(overrides?: IGenerateIo): 0 | 2;
