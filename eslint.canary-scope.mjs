// @ts-check
/**
 * Single source of truth for the scope of the SonarJS parity rules.
 *
 * Three consumers need the same answer to "which files are these rules
 * meant to police?": `eslint.config.mjs` (which enforces them),
 * `src/Tests/Tools/LintValidator.ts` (whose canaries must fire on exactly
 * the same set), and the test that pins that behaviour. Holding three
 * hand-maintained copies made drift a matter of time — a canary mirroring
 * a stale scope reports on files ESLint no longer covers, which is the
 * precise failure this PR exists to remove.
 *
 * Keeping the lists here makes drift impossible rather than merely
 * detectable. Edit this file and every consumer moves together.
 */

/**
 * Directory prefixes outside SonarCloud's analysis, mirroring
 * `sonar.exclusions` in `sonar-project.properties`. Stored in
 * trailing-slash prefix form because that is the shape path matching
 * needs; the glob shape ESLint wants is derived below.
 * @type {readonly string[]}
 */
export const SONAR_PARITY_IGNORE_PREFIXES = Object.freeze([
  'src/Tests/',
  'src/Common/',
  'src/Scrapers/Behatsdaa/',
  'src/Scrapers/BeyahadBishvilha/',
  'src/Scrapers/Leumi/',
  'src/Scrapers/Mizrahi/',
  'src/Scrapers/Yahav/',
  'src/Scrapers/Registry/',
  'src/scrapers/',
]);

/**
 * The same scope in the glob form ESLint's `ignores` expects. Derived so
 * the two representations cannot disagree.
 * @type {readonly string[]}
 */
export const SONAR_PARITY_IGNORE_GLOBS = Object.freeze(
  SONAR_PARITY_IGNORE_PREFIXES.map(prefix => `${prefix}**`),
);

/**
 * The e2e-mocked suites permitted to keep an unconditional
 * `describe.skip(...)` while their fixtures are captured
 * (tasks/phase-7-5-T8-T12). Exact file paths, never prefixes: an entry
 * here must not exempt a longer sibling name.
 *
 * Remove an entry when its suite is unskipped — `sonarjs/no-skipped-tests`
 * then fires on any remaining `.skip` and blocks the merge.
 * @type {readonly string[]}
 */
export const SKIP_ALLOWLIST_FILES = Object.freeze([
  'src/Tests/E2eMocked/Amex.e2e-mocked.test.ts',
  'src/Tests/E2eMocked/Isracard.e2e-mocked.test.ts',
  'src/Tests/E2eMocked/ErrorScenarios.e2e-mocked.test.ts',
  'src/Tests/E2eMocked/ExternalBrowser.e2e-mocked.test.ts',
  'src/Tests/E2eMocked/Discount/Discount.e2e-mocked.test.ts',
  'src/Tests/E2eMocked/Max/Max.e2e-mocked.test.ts',
  'src/Tests/E2eMocked/VisaCal/VisaCal.e2e-mocked.test.ts',
]);
