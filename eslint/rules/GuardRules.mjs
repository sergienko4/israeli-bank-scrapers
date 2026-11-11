// @ts-check
/**
 * Named single-purpose rules, shared option objects, and the inline
 * Phase 9 plugin used by every config cluster.
 */
// PII Screenshot Bypass Prevention — added 2026-05-21 after CI artifact
// 7128234088 leaked 18+ post-auth PNGs (PR #248, run 26207506594).
// Bans `page.screenshot(...)` everywhere it is armed; the pipeline is pure
// HTTP, so no sanctioned call site remains.
const NO_DIRECT_SCREENSHOT_RULE = {
  selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="screenshot"]',
  message:
    'page.screenshot(...) is forbidden — rendered bank pixels must never reach public CI artifacts (PR #248). The pipeline is pure HTTP and has no page to capture.',
};

// RULE #10 — RAW `page` OUT OF PIPELINE BUSINESS LOGIC. Added 2026-08 after the
// post-#538 knowledge-graph refresh found the ban had never applied to
// production: the only `page` selector in this file lived inside the
// `src/Tests/**/Pipeline/**` block (§5), so `npx eslint` on a production file
// calling `page.goto()` exited 0, and rule10-phase-violation.canary.ts stayed
// green on unrelated lint noise. Browser access belongs to the Mediator (P7,
// general-rules-guidlines.md); Phases/Core/Banks/Registry/Logging reach it
// through `ctx.mediator`. Shared by §5 (tests) and §21 (production) so the two
// scopes cannot drift apart into two different meanings of "Rule #10".
//
// KNOWN LIMITS — this selector matches a call whose receiver is literally an
// identifier spelled `page`. It therefore MISSES: `this.page.click()` and
// `this._page.context()`; an alias (`const p = page; p.click()`); a
// differently-named parameter (`loginPage.click()`); a nested receiver
// (`args.page.click()`); a sub-namespace (`page.keyboard.press()`); and
// destructured or `.bind()`-detached methods. It also FALSELY flags any
// unrelated object that happens to be named `page`. It bans one spelling, not
// the capability. Closing that gap needs a type-aware custom rule that resolves
// the receiver to Playwright's `Page` — tracked as a follow-up, deliberately
// out of scope here (eslint-rules-guidlines.md §5: one guardrail per commit).
const RULE10_NO_RAW_PAGE_RULE = {
  selector: "CallExpression[callee.object.name='page']",
  message:
    "🚫 Rule #10: Direct calls to 'page' are forbidden in Pipeline business logic. Browser access belongs to the Mediator — use ctx.mediator instead.",
};

// SHAPE WINDOW-END FROM THE CLOCK — added 2026-06 with the window-coverage
// backfill. Every api-direct bank that bounds its transactions request used to
// derive that bound from a bare `moment()` / `new Date()`, once per shape, in
// six different wire encodings. The backfill loop re-asks for an older slice by
// handing the shape a context whose `windowEnd` is narrowed, which only works
// while `scrapeWindowEnd(ctx)` is the single place "the end of the window" is
// decided. A shape that reads the clock directly silently opts out of the
// backfill and re-introduces the transaction loss the loop exists to close.
const SHAPE_TXNS_WINDOW_END_RULE = {
  selector:
    "CallExpression[callee.name='moment'][arguments.length=0], NewExpression[callee.name='Date'][arguments.length=0], CallExpression[callee.object.name='Date'][callee.property.name='now']",
  message:
    'Reading the clock in a *ShapeTxns.ts file detaches it from the scrape window. Use scrapeWindowEnd(ctx) from src/Scrapers/Pipeline/Mediator/Scrape/ScrapeWindowEnd.ts so the coverage backfill can narrow the bound.',
};

// §8i: `<x>.balance ?? 0` makes "balance unknown" indistinguishable from a real
// zero, so PipelineResult can no longer fall back to the legacy SCRAPE value.
const BALANCE_DEFAULT_DENY_RULES = [
  {
    selector: "LogicalExpression[operator='??'][left.property.name='balance'][right.value=0]",
    message:
      '🚫 BALANCE DEFAULT-DENY (CR #264 Major): `acc.balance ?? 0` collapses unknown into a real zero. Skip the entry (or surface a typed failure) instead.',
  },
  {
    selector: "LogicalExpression[operator='??'][left.property.name='balance'][right.raw='null']",
    message:
      '🚫 BALANCE DEFAULT-DENY (CR #264 Major): `acc.balance ?? null` is forbidden for the same reason as `?? 0` — use a typed skip.',
  },
];

// §12C: `lower*Keys` names a membership-test set (Sonar S7776) built as an
// array, so every lookup is O(n). sonarjs@4 does not expose S7776.
const LOWER_KEYS_ARRAY_RULE = {
  selector: 'VariableDeclarator[id.name=/^lower\\w*Keys$/]',
  message:
    'PR #281 C8 §12C: name `lower*Keys` implies a key set for membership testing (Sonar S7776). Use `new Set(keys.map(k => k.toLowerCase()))` named `lower*KeySet`, or rename to `lowerNames` if iterating only.',
};

// §24 BANK CALENDAR BOUNDARY — added 2026-09 after issue #553's review found
// the SAME defect in three unrelated scrape sites, one at a time, across ten
// review rounds. `MonthChunking.buildChunk` writes a chunk start from a
// BANK-calendar day and appends the text `T00:00:00.000Z`; the `Z` is a
// formatting literal, not a UTC claim. Reading that back with host-local
// getters made a scrape for March ask the bank for February on any host west
// of UTC — the provider answered `200 OK` with the wrong month, nothing threw,
// and the window simply came back short.
//
// Patching the sites one at a time lost: two were fixed and a third survived.
// `Mediator/Scrape/BankCalendar.ts` is the sanctioned reader, and these
// selectors are what make going through it mandatory rather than customary.
// Deliberately aimed at the defect MECHANISM — reading or building calendar
// COMPONENTS in the host's zone — and not at `new Date(x)` generally, because
// a Date that is only passed along as an instant is harmless.
const BANK_CALENDAR_HOST_READ_RULE = {
  selector:
    'CallExpression[callee.type="MemberExpression"][callee.property.name=/^get(FullYear|Month|Date|Day|Hours|Minutes|Seconds)$/]',
  message:
    '🚫 BANK CALENDAR: `.getMonth()` / `.getFullYear()` / `.getDate()` read the HOST machine calendar, so one instant names a different day west of UTC. Use bankMomentOfInstant() / bankDayOfInstant() from src/Scrapers/Pipeline/Mediator/Scrape/BankCalendar.ts — or read the label directly when the value already carries one.',
};

const BANK_CALENDAR_HOST_FORMAT_RULE = {
  selector:
    'CallExpression[callee.type="MemberExpression"][callee.property.name="toLocaleDateString"]',
  message:
    '🚫 BANK CALENDAR: `.toLocaleDateString()` can format a date in the HOST machine calendar because a locale does not select a timezone. Use bankMomentOfInstant() or bankDayOfInstant() before formatting.',
};

const BANK_CALENDAR_UTC_READ_RULE = {
  selector:
    'CallExpression[callee.type="MemberExpression"][callee.property.name=/^getUTC(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$/]',
  message:
    '🚫 BANK CALENDAR: raw `.getUTCMonth()` / `.getUTCDate()` component reads bypass the bank-calendar provider and can mistake a formatted bank label for a UTC instant. Use bankMomentOfInstant() / bankDayOfInstant(), or read and validate the label directly.',
};

const BANK_CALENDAR_UTC_BUILD_RULE = {
  selector:
    'CallExpression[callee.type="MemberExpression"][callee.object.name="Date"][callee.property.name="UTC"]',
  message:
    '🚫 BANK CALENDAR: do not construct calendar parts through UTC; Date.UTC normalizes invalid dates and rewrites years 0–99. Validate the label and resolve it through BankCalendar.',
};

const BANK_CALENDAR_MOMENT_RULE = {
  selector:
    ':matches(CallExpression[callee.name="moment"], CallExpression[callee.type="MemberExpression"][callee.object.name="moment"][callee.property.name="tz"])',
  message:
    '🚫 BANK CALENDAR: direct `moment(...)` / `moment.tz(...)` calls bypass the Pipeline bank-calendar provider and can inherit the shared default zone. Use parseInBankZone(), bankMomentOfInstant(), or another BankCalendar helper.',
};

const BANK_CALENDAR_HOST_BUILD_RULE = {
  selector: 'NewExpression[callee.name="Date"][arguments.length>=2]',
  message:
    '🚫 BANK CALENDAR: `new Date(year, month, day)` resolves those components in the HOST zone, so the instant it produces depends on where the scraper runs. Build it in the bank calendar with parseInBankZone() from src/Scrapers/Pipeline/Mediator/Scrape/BankCalendar.ts.',
};

// §13: every redaction sentinel must be defined once in PiiRedactor/Types.ts
// and imported, so a hint can be changed in one place.
const PII_SENTINEL_LITERAL_RULES = [
  {
    selector: "Literal[value='[REDACTED]']",
    message:
      "🚫 PII CONSTANT: Import { REDACTED_HINT } from './Types.js' instead of hardcoding '[REDACTED]'. " +
      'CR cycle-1 #9 / CLAUDE.md "Constants from configuration — never hardcode values inline".',
  },
  {
    selector: "Literal[value='[OTP]']",
    message:
      "🚫 PII CONSTANT: Import { OTP_HINT } from './Types.js' instead of hardcoding '[OTP]'.",
  },
  {
    selector: "Literal[value='[REDACTION_ERROR]']",
    message:
      "🚫 PII CONSTANT: Import { REDACTION_ERROR_HINT } from './Types.js' instead of hardcoding '[REDACTION_ERROR]'.",
  },
  {
    // CR cycle-2: catches `'-***'` / `'+***'` / `'***'` (Amount sign markers) and
    // any future bracket-name sentinel (e.g. `'[NEW_HINT]'`). Forces every NEW
    // redaction sentinel to live in Types.ts before it can be used elsewhere.
    selector: 'Literal[value=/^(\\[[A-Z_]+\\]|[+\\-]?\\*{3,})$/]',
    message:
      "🚫 PII SENTINEL: Hardcoded redaction sentinel detected. Define it once in './Types.js' " +
      '(e.g. AMOUNT_NEGATIVE_HINT, AMOUNT_POSITIVE_HINT) and import the constant. ' +
      'CR cycle-2 / CLAUDE.md "Constants from configuration — never hardcode values inline".',
  },
];

// `ErrorLog.ts` must always-redact: bank error messages are security-classified
// (CodeQL #28 / CR cycle-1 #3), so `PII_REDACTION=off` must not reach them.
// Named so §13C and the canary block in §22a arm the identical entry.
const PII_ERRORLOG_NO_BYPASS_RULE = {
  selector: "Identifier[name='isPiiRedactionDisabled']",
  message:
    '🚫 SECURITY (CodeQL #28 / CR cycle-1 #3): ErrorLog.ts MUST always-redact. ' +
    'Do not reference isPiiRedactionDisabled here — bank error messages are ' +
    'security-classified and cannot be bypassed via PII_REDACTION=off.',
};

// Mocks must not bypass the type system. Declared as a const rather than
// inline for the same reason as NO_EXPORT_DEFAULT_RULE: the canary contract
// (§22) has to arm the identical entry.
const TEST_INTEGRITY_NO_AS_NEVER_RULE = {
  selector: 'TSAsExpression > :matches(TSNeverKeyword, TSAnyKeyword)',
  message:
    "🚫 TEST INTEGRITY: Do not use 'as never' or 'as any' in mocks. Use 'DeepPartial<T>' or implement the required interface.",
};

// Named exports only. Declared as a const rather than inline so the canary
// contract (§22) can arm the exact same entry — `default-export.canary.ts`
// certified this rule while resolving to a config that never contained it.
//
// Armed on Pipeline TESTS and the canary directory only, never on production:
// `src/**` runs `import-x/prefer-default-export`, which requires the opposite
// on a single-export file, and 271 `src/` files export a default accordingly.
// The message named "Pipeline/Strategy files" while firing on neither, so it
// read as a production guarantee that no production file has ever been held
// to. Whether to reconcile the two rules is a convention decision, not a
// guardrail repair; until it is taken, the message states its real reach.
const NO_EXPORT_DEFAULT_RULE = {
  selector: 'ExportDefaultDeclaration',
  message:
    "🚫 ARCHITECTURE: Named exports only. Do not use 'export default' in Pipeline test or canary files.",
};

// §19.9 TEST-HELPER STATEMENT CAP — fires on any `function foo() { ...11+ stmts }`
// inside `src/Tests/**`. Scoped to `FunctionDeclaration` so legitimate
// `describe('...', () => { ... })` / `it('...', () => { ... })` /
// `it.each(cases)('...', (...) => { ... })` arrow callbacks stay
// excluded (their bodies are ArrowFunctionExpression nodes). Drives
// helper extraction without touching natural test-block length.
//
// Selector `[id.name]` constraint: only named FunctionDeclarations
// trigger. Anonymous `export default function() {}` form (rare) is
// excluded per CR cycle 2 finding — defaults are caught by §6 default-
// export ban anyway.
//
// Why a separate const (not embedded in RESTRICTED_SYNTAX_RULES):
// the shared set is also used by production scopes, where this rule
// would double-fire alongside `max-statements:10` (and over-fire vs
// grandfather caps in §19.1-§19.5). Keeping it test-only avoids
// redundant noise in production lint output.
const TEST_HELPER_OVER_10_STMTS_RULE = {
  selector: 'FunctionDeclaration[id.name][body.body.length>10]',
  message:
    '🚫 §19.9 TEST HELPER CAP: Named test helper functions cannot exceed 10 statements. Extract focused sub-helpers (Extract Function) so each helper does one thing. Arrow callbacks of describe/it/it.each are exempt (only FunctionDeclaration fires).',
};

/**
 * Suppression-comment ban options, shared by §15 (production) and §15a (canary).
 *
 * Hoisted so the canary that certifies the rule is provably armed with the SAME
 * term list production carries. Inlined twice, the two could drift and the
 * canary would keep passing while guarding a shorter list than production uses.
 */
const SUPPRESSION_COMMENT_OPTIONS = {
  terms: [
    'NOSONAR',
    '@ts-ignore',
    '@ts-expect-error',
    '@ts-nocheck',
    'biome-ignore',
    'eslint-disable',
    'istanbul ignore',
    'c8 ignore',
    'v8 ignore',
    'prettier-ignore',
  ],
  location: 'anywhere',
};

// Phase 3 Common ↔ Pipeline unification guard — Commit 11 (refactor/phase-3-common-unify).
//
// Bans Pipeline production code from importing Common/* (Pipeline is canonical;
// Common is the deprecated re-export shim layer). Uses `regex` (not `group`) so
// the ban stays a single anchored pattern that no file-level `ignores` can
// narrow. No Pipeline → Common edge remains: the only allowlisted module,
// `Common/Config/BrowserConfig`, left with the browser engine.
const PHASE3_COMMON_IMPORT_BAN_PATTERN = {
  regex: String.raw`Common/`,
  message:
    '🚫 PHASE-3 ARCHITECTURE: Pipeline production code must not import from Common/*. Pipeline is canonical; Common/* is a deprecated re-export shim. Import the symbol from src/Scrapers/Pipeline/Mediator/<Subdir>/<Module>.js instead.',
};

export {
  BALANCE_DEFAULT_DENY_RULES,
  BANK_CALENDAR_HOST_BUILD_RULE,
  BANK_CALENDAR_HOST_FORMAT_RULE,
  BANK_CALENDAR_HOST_READ_RULE,
  BANK_CALENDAR_MOMENT_RULE,
  BANK_CALENDAR_UTC_BUILD_RULE,
  BANK_CALENDAR_UTC_READ_RULE,
  LOWER_KEYS_ARRAY_RULE,
  NO_DIRECT_SCREENSHOT_RULE,
  NO_EXPORT_DEFAULT_RULE,
  PHASE3_COMMON_IMPORT_BAN_PATTERN,
  PII_ERRORLOG_NO_BYPASS_RULE,
  PII_SENTINEL_LITERAL_RULES,
  RULE10_NO_RAW_PAGE_RULE,
  SHAPE_TXNS_WINDOW_END_RULE,
  SUPPRESSION_COMMENT_OPTIONS,
  TEST_HELPER_OVER_10_STMTS_RULE,
  TEST_INTEGRITY_NO_AS_NEVER_RULE,
};
