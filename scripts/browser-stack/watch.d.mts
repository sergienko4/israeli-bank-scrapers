/**
 * Type declarations for `scripts/browser-stack/watch.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type their I/O rather than import `any`.
 */

import type { IPlatformAssetCheck } from './camoufox-releases.mjs';
import type { IFetchIo, IGateIo } from './gate.mjs';

/** Injectable I/O of one watch run; production defaults fill every omitted member. */
export interface IWatchIo {
  readonly manifestPath?: string;
  readonly lockfilePath?: string;
  /** The library's `package.json`, whose `playwright-core` range a consumer resolves. */
  readonly packagePath?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: IFetchIo;
  readonly assetCheck?: () => Promise<IPlatformAssetCheck>;
  readonly runGate?: (args: readonly string[], overrides: IGateIo) => Promise<0 | 1 | 2>;
  readonly now?: () => Date;
  readonly writeFile?: (path: string, text: string) => void;
  readonly stdout?: (text: string) => boolean;
  readonly stderr?: (text: string) => boolean;
}

/** How many gate runs are in flight at once. */
export declare const GATE_CONCURRENCY: number;

/**
 * Run the watch once.
 *
 * @param args - CLI arguments after the script path.
 * @param overrides - Test I/O.
 * @returns 0 report written, 2 the watch cannot read its inputs.
 * @throws {Error} Only on a bug: anything that is not an input failure.
 */
export function runWatch(args: readonly string[], overrides?: IWatchIo): Promise<0 | 2>;
