/**
 * Type declarations for `scripts/check-staged-pii.cjs`.
 *
 * The script is plain Node (`allowJs: false` in tsconfig), so the `.ts`
 * suite that drives its pure core needs this to type its assertions.
 */

/**
 * The `git` arguments for the additions to scan.
 *
 * @param baseSha - Pull request base commit, or `''` for the staged index.
 * @returns `diff --cached` arguments, a `<base>...HEAD` range, or `null` when
 *   the base is not a commit id.
 */
export function diffArgs(baseSha: string): readonly string[] | null;

/**
 * Files whose added lines carry a value from the denylist.
 *
 * @param deny - sha256 hex digests of known real values.
 * @param diff - Unified diff text, `--unified=0`.
 * @returns Offending file paths, each once.
 */
export function findOffendingFiles(deny: ReadonlySet<string>, diff: string): string[];
