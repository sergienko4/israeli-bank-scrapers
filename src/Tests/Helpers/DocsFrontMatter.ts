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
 *       with a letter does;</li>
 *   <li>one layer of surrounding quotes is stripped from each entry.</li>
 * </ul>
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
  const lines = text.split(/\r?\n/);
  const open = lines.indexOf('---');
  if (open < 0) return [];
  const rest = lines.slice(open + 1);
  const close = rest.indexOf('---');
  return close < 0 ? rest : rest.slice(0, close);
}

/**
 * Recognises the enrolment key, mirroring `^source-files:[[:space:]]*$`.
 *
 * @param line - One front-matter line.
 * @returns True when the line opens the enrolment list.
 */
function isKey(line: string): boolean {
  return /^source-files:[ \t]*$/.test(line);
}

/**
 * Recognises a list entry, mirroring `^[[:space:]]*-[[:space:]]*(.+)$`.
 *
 * @param line - One front-matter line.
 * @returns True when the line carries a value the gate would emit.
 */
function isEntry(line: string): boolean {
  return /^[ \t]*-[ \t]*\S/.test(line);
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
 * @param line - A line already accepted by the entry test.
 * @returns The declared path, stripped of its marker and quotes.
 */
function entryValue(line: string): string {
  const raw = line.replace(/^[ \t]*-[ \t]*/, '');
  const bare = raw.replace(/^["']/, '').replace(/["']$/, '');
  return bare.trim();
}

/**
 * Reads the source paths a docs page enrols in the staleness gate.
 *
 * @param text - The page's full text.
 * @returns Each declared path, as the gate would record it.
 */
export default function enrolledSources(text: string): readonly string[] {
  const lines = frontMatter(text);
  const start = lines.findIndex(isKey);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(endsBlock);
  const block = end < 0 ? rest : rest.slice(0, end);
  return block.filter(isEntry).map(entryValue);
}
