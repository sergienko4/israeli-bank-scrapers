/**
 * Type declarations for `scripts/dev-tooling/watch.mjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts` tests
 * that drive it need this to type their I/O rather than import `any`.
 */

/** What one command did: its exit status (1 when it did not finish) and output. */
export interface IRunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Why it did not finish (timed out, killed, could not start); absent when it exited. */
  readonly unfinished?: string;
}

/** One static gate the grouped update must pass. */
export interface IGate {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

/** Injectable I/O of one watch run; production defaults fill every omitted member. */
export interface IDevToolingWatchIo {
  readonly dependabotPath?: string;
  readonly packagePath?: string;
  readonly lockPath?: string;
  readonly readFile?: (path: string) => string;
  /** Runs `npm view`, `npm install`, `npm ls` and every gate, in the repository root. */
  readonly run?: (command: string, args: readonly string[]) => IRunResult;
  readonly now?: () => Date;
  readonly writeFile?: (path: string, text: string) => void;
  readonly stdout?: (text: string) => boolean;
  readonly stderr?: (text: string) => boolean;
}

/** The static gates, in run order. */
export const GATES: readonly IGate[];

/**
 * Run the watch once.
 *
 * @param args - CLI arguments after the script path.
 * @param overrides - Test I/O.
 * @returns 0 verdict written, 2 the watch cannot read its inputs.
 * @throws {Error} Only on a bug: anything that is not an input failure.
 */
export function runWatch(args: readonly string[], overrides?: IDevToolingWatchIo): 0 | 2;
