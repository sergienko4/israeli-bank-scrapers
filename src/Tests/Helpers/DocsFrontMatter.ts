/**
 * Reads a docs page's `source-files:` enrolment exactly as CI reads it.
 *
 * The docs-staleness gate (`.github/scripts/ci/docs-staleness.sh`, function
 * `build_inverted_map`) is the only consumer whose opinion counts: a module is
 * covered when that shell parser finds it, and uncovered otherwise. A reader
 * that accepts more than the gate would claim coverage the gate never
 * delivers — a silent exemption. So this parser mirrors the gate's grammar
 * rather than YAML's, reproducing its narrowness on purpose:
 *
 * <ul>
 *   <li>only the first `---` … `---` block counts, so a `source-files:` key in
 *       the body, inside a fenced example, or in a second front-matter-looking
 *       block is invisible here exactly as it is to the gate;</li>
 *   <li>the key sits at column zero and carries nothing but trailing blanks;</li>
 *   <li>blank lines and `#` comments do not end the list, but a line opening
 *       with a letter does — and a second key reopens it;</li>
 *   <li>a double quote and then a single quote are stripped from each end, as
 *       four independent steps, before any whitespace is trimmed;</li>
 *   <li>an entry that normalises to nothing enrols nothing.</li>
 * </ul>
 *
 * <p>Blank means POSIX `[[:space:]]`, so vertical tab and form feed count.
 *
 * A change to the gate's grammar belongs in this file in the same commit.
 */

/**
 * Extracts the page's front matter.
 *
 * <p>The gate opens at the first line that is exactly `---` and closes at the
 * next one, reading to the end of the file when no closing marker exists.
 *
 * @param text - The page's full text.
 * @returns The lines strictly inside the block, empty when there is none.
 */
function frontMatter(text: string): readonly string[] {
  const lines = text.split('\n').map(stripCr);
  const open = lines.indexOf('---');
  if (open < 0) return [];
  const rest = lines.slice(open + 1);
  const close = rest.indexOf('---');
  return close < 0 ? rest : rest.slice(0, close);
}

/**
 * Removes the carriage return a CRLF page leaves on a line.
 *
 * <p>The gate does this first, before any other test, so a page whose final
 * line carries a CR but no newline is still read cleanly.
 *
 * @param line - One raw line.
 * @returns The line without its trailing carriage return.
 */
function stripCr(line: string): string {
  return line.replace(/\r$/, '');
}

/**
 * Recognises the enrolment key, mirroring `^source-files:[[:space:]]*$`.
 *
 * <p>`[ \t\v\f]` is POSIX `[[:space:]]` minus the line terminators, which a
 * single line never contains once {@link stripCr} has run.
 *
 * @param line - One front-matter line.
 * @returns True when the line opens the enrolment list.
 */
function isKey(line: string): boolean {
  return /^source-files:[ \t\v\f]*$/.test(line);
}

/**
 * Recognises a list entry, mirroring `^[[:space:]]*-[[:space:]]*(.+)$`.
 *
 * @param line - One front-matter line.
 * @returns True when the line carries a value the gate would emit.
 */
function isEntry(line: string): boolean {
  return /^[ \t\v\f]*-[ \t\v\f]*\S/.test(line);
}

/**
 * Recognises the end of the list, mirroring the gate's `^[A-Za-z]` test.
 *
 * <p>Blank lines and `#` comments deliberately do not end the block: the gate
 * keeps reading past them, so a reader that stopped would under-report.
 *
 * @param line - One front-matter line.
 * @returns True when the line starts a sibling key.
 */
function endsBlock(line: string): boolean {
  return /^[a-z]/i.test(line);
}

/**
 * Reduces one list entry to the path the gate would emit.
 *
 * <p>The gate strips one double quote and then one single quote from each end,
 * as four independent operations, and only then trims. Order matters: a
 * trailing space strands the closing quote inside the path, and mirroring that
 * is what keeps this reader honest about what CI actually covers.
 *
 * @param line - A line already accepted by the entry test.
 * @returns The declared path, stripped of its marker and quotes.
 */
function entryValue(line: string): string {
  const raw = line.replace(/^[ \t\v\f]*-[ \t\v\f]*/, '');
  const unDoubled = raw.replace(/^"/, '').replace(/"$/, '');
  const bare = unDoubled.replace(/^'/, '').replace(/'$/, '');
  return bare.replace(/^[ \t\v\f]+/, '').replace(/[ \t\v\f]+$/, '');
}

/** One line's worth of progress through the enrolment list. */
interface IScan {
  /** Whether the list is currently open. */
  readonly open: boolean;
  /** The paths recorded so far. */
  readonly found: readonly string[];
}

/**
 * Adds an entry's path, unless it normalises to nothing.
 *
 * <p>The gate's `[ -n "$src" ]` guard means an entry that is only quotes or
 * blanks enrols no file, so neither does this.
 *
 * @param found - The paths recorded so far.
 * @param line - The entry line to record.
 * @returns The paths including this entry, when it carries one.
 */
function collect(found: readonly string[], line: string): readonly string[] {
  const value = entryValue(line);
  return value === '' ? found : [...found, value];
}

/**
 * Advances the scan by one front-matter line.
 *
 * <p>The gate tests every line for the key before it consults the open list,
 * so a key encountered after a sibling has closed the list reopens it.
 *
 * @param scan - The scan so far.
 * @param line - The next front-matter line.
 * @returns The scan after this line.
 */
function step(scan: IScan, line: string): IScan {
  if (isKey(line)) return { open: true, found: scan.found };
  if (!scan.open) return scan;
  if (isEntry(line)) return { open: true, found: collect(scan.found, line) };
  return { open: !endsBlock(line), found: scan.found };
}

/**
 * Reads the source paths a docs page enrols in the staleness gate.
 *
 * @param text - The page's full text.
 * @returns Each declared path, as the gate would record it.
 */
export default function enrolledSources(text: string): readonly string[] {
  const seed: IScan = { open: false, found: [] };
  return frontMatter(text).reduce(step, seed).found;
}
