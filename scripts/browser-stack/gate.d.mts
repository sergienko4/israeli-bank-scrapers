/**
 * Type declarations for `scripts/browser-stack/gate.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type their I/O rather than import `any`.
 */

/** Injectable network I/O of the bounded fetcher (`fetch-protocol.mjs`). */
export interface IFetchIo {
  readonly fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  readonly sleep?: (ms: number) => Promise<unknown>;
  readonly timeoutMs?: number;
}

/** Injectable I/O of one gate run; production defaults fill every omitted member. */
export interface IGateIo {
  readonly manifestPath?: string;
  readonly lockfilePath?: string;
  readonly generatedPath?: string;
  readonly fetch?: IFetchIo;
  readonly stdout?: (text: string) => boolean;
  readonly stderr?: (text: string) => boolean;
}

/**
 * Run the gate once.
 *
 * @param args - CLI arguments after the script path.
 * @param overrides - Test I/O.
 * @returns 0 pass, 1 a finding fails the mode, 2 the gate cannot decide.
 * @throws {Error} Only on a bug: anything that is not an infrastructure failure.
 */
export function runGate(args: readonly string[], overrides?: IGateIo): Promise<0 | 1 | 2>;
