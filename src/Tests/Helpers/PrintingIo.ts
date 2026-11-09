/**
 * Output I/O for script tests: captures what a run prints and writes, on a
 * fixed clock, so a watch script's report can be asserted without touching
 * the real console or disk.
 */

import type { IDevToolingWatchIo } from '../../../scripts/dev-tooling/watch.mjs';

/** The clock of every run. */
const CHECKED_AT = '2026-05-04T06:00:00Z';

/** What one run printed and wrote. */
export interface IPrinted {
  out: string;
  err: string;
  readonly written: Record<string, string>;
}

/** The output members of the watch I/O. */
export type PrintingIo = Required<
  Pick<IDevToolingWatchIo, 'now' | 'writeFile' | 'stdout' | 'stderr'>
>;

/**
 * Output I/O of one run that captures into `printed`, on a fixed clock.
 *
 * @param printed - Where the output goes.
 * @returns `now`, `writeFile`, `stdout` and `stderr`.
 */
export function printingIo(printed: IPrinted): PrintingIo {
  return {
    /**
     * A fixed clock.
     *
     * @returns The check date.
     */
    now: (): Date => new Date(CHECKED_AT),
    /**
     * Record a written file.
     *
     * @param path - File path.
     * @param text - File text.
     * @returns Always true.
     */
    writeFile: (path: string, text: string): boolean => {
      printed.written[path] = text;
      return true;
    },
    /**
     * Capture stdout.
     *
     * @param text - Written text.
     * @returns Like `process.stdout.write`.
     */
    stdout: (text: string): boolean => {
      printed.out += text;
      return true;
    },
    /**
     * Capture stderr.
     *
     * @param text - Written text.
     * @returns Like `process.stderr.write`.
     */
    stderr: (text: string): boolean => {
      printed.err += text;
      return true;
    },
  };
}
