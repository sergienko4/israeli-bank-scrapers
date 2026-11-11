// @ts-check
/**
 * The resolved Pipeline `no-restricted-syntax` contract, its drain queue,
 * per-file exemptions, scoped extras, and the helpers the guardrail gate
 * imports.
 */
import {
  BANK_CALENDAR_HOST_BUILD_RULE,
  BANK_CALENDAR_HOST_FORMAT_RULE,
  BANK_CALENDAR_HOST_READ_RULE,
  BANK_CALENDAR_MOMENT_RULE,
  BANK_CALENDAR_UTC_BUILD_RULE,
  BANK_CALENDAR_UTC_READ_RULE,
  LOWER_KEYS_ARRAY_RULE,
  NO_DIRECT_SCREENSHOT_RULE,
  NO_EXPORT_DEFAULT_RULE,
  RULE10_NO_RAW_PAGE_RULE,
  SHAPE_TXNS_WINDOW_END_RULE,
  TEST_HELPER_OVER_10_STMTS_RULE,
  TEST_INTEGRITY_NO_AS_NEVER_RULE,
} from './GuardRules.mjs';
import {
  RESTRICTED_SYNTAX_RULES,
  RESTRICTED_SYNTAX_RULES_NEW,
} from './RestrictedSyntax.mjs';

// ---------------------------------------------------------------------------
// PIPELINE SYNTAX CONTRACT — the set §6 must actually deliver.
//
// Flat config REPLACES `no-restricted-syntax` options; it never merges them.
// Two blocks both matching a Pipeline file means the later one wins outright,
// and every selector unique to the earlier one silently evaporates. That is
// not a hypothetical: §14 (`files: ['src/**\/*.ts']`) sorted after §6 and
// matched a superset of its files, so the 23 selectors unique to
// RESTRICTED_SYNTAX_RULES_NEW resolved to nothing on production code from the
// day they were written (7d52e9ff, 2026-05-31) until this contract existed.
//
// The failure is invisible to reading and to grep — the selectors are present
// in this file either way — so it is asserted empirically instead, against the
// RESOLVED configuration, by `npm run lint:syntax-guardrails`.
// ---------------------------------------------------------------------------

/**
 * Selectors the Pipeline contract defines but production code still violates,
 * and which are therefore not yet enforced.
 *
 * This list is a DRAIN QUEUE, not an exemption list. It may only ever shrink:
 * each entry is removed in its own `chore(eslint):` commit once the violations
 * behind it are refactored away (`eslint-rules-guidlines.md` §1, §4 — tighten,
 * never weaken; narrow scope, never raise a cap). `check-syntax-guardrails`
 * fails if an entry here is not a real member of `RESTRICTED_SYNTAX_RULES_NEW`
 * or `PIPELINE_REVIEW_RULES`, so a typo cannot disarm a selector by accident,
 * and a selector shared with the repo-wide legacy set can never be queued —
 * that would open a Pipeline-only hole in a rule the rest of `src` still obeys.
 *
 * Counts are production violations under `src/Scrapers/Pipeline` measured when
 * each entry was added; they are indicative, not asserted.
 */
const PIPELINE_SYNTAX_PENDING_DRAIN = new Set([
  // 183 — ternaries. The largest single debt; draining it is a readability
  // refactor across the whole tree, not a guardrail change.
  'ConditionalExpression',
  // 111 — `unknown` parameters.
  ':matches(FunctionDeclaration, ArrowFunctionExpression, MethodDefinition) Identifier > TSTypeAnnotation > TSUnknownKeyword',
  // 80 — `unknown` return types.
  ':matches(FunctionDeclaration, ArrowFunctionExpression, MethodDefinition) > TSTypeAnnotation TSUnknownKeyword',
  // 43 in 30 files — CR-P2 `expr as unknown as T` double-casts. Concentrated in
  // the Mediator's browser-facing edges, where a DOM/JSON value is narrowed to
  // a domain type. Draining it means giving those boundaries real projectors,
  // which is a typing refactor with its own review.
  'TSAsExpression > TSAsExpression',
  // 20 — direct instantiation outside the DI container.
  'NewExpression[callee.name=/^(?!Error|Map|Set|Date|RegExp|URL|Headers|EventEmitter|ScraperError|PipelineBuilder|DashboardPhase|ScrapePhase|OtpPhase|TerminatePhase)[A-Z]/]',
  // 17 — `''` fallbacks in business logic.
  "VariableDeclarator[id.name!=/text|html|content|val|attr/i] > LogicalExpression[right.value='']",
  // 10 — `else` blocks.
  'IfStatement[alternate]',
  // 8 in 6 files — CR-P1 `ReadonlySet<string>`. Each site needs a literal union
  // to narrow to, so the drain is per-call-site type work.
  'TSTypeReference[typeName.name="ReadonlySet"] > TSTypeParameterInstantiation > TSStringKeyword',
  // 5 — hardcoded config literals.
  'Property[key.name=/viewport|width|height|timeout|delay|retries/i] > Literal',
  // 3 — manual `.message` access inside `catch`.
  "CatchClause MemberExpression[property.name='message']",
  // 3 — manual pagination loops.
  'WhileStatement, DoWhileStatement',
  // 2 — `Promise.any` (swallows errors).
  "CallExpression[callee.object.name='Promise'][callee.property.name='any']",
  // 1 — functions returning `null`/`undefined`.
  ":matches(TSFunctionType, MethodDefinition, FunctionDeclaration) TSTypeAnnotation :matches(Identifier[name='null'], Identifier[name='undefined'], TSNullKeyword, TSUndefinedKeyword)",
  // 1 — `void` return types.
  ':matches(TSFunctionType, MethodDefinition, FunctionDeclaration) TSTypeAnnotation > TSVoidKeyword',
]);

/**
 * Read an entry's selector, accepting both spellings used in these arrays.
 * @param entry - Bare selector string, or `{ selector, message }`.
 * @returns The selector string.
 */
const selectorOf = entry => (typeof entry === 'string' ? entry : entry.selector);

/**
 * Review-derived Pipeline selectors, formerly written inline inside §6.
 *
 * Hoisted so they are addressable: while they lived inside the §6 rule array
 * they could be neither queued for drain nor named by a canary, and — like
 * the rest of §6 — they were being overwritten wholesale by §14 and so never
 * fired on a single production file.
 */
const PIPELINE_REVIEW_RULES = [
  BANK_CALENDAR_HOST_READ_RULE,
  BANK_CALENDAR_HOST_FORMAT_RULE,
  BANK_CALENDAR_UTC_READ_RULE,
  BANK_CALENDAR_UTC_BUILD_RULE,
  BANK_CALENDAR_MOMENT_RULE,
  BANK_CALENDAR_HOST_BUILD_RULE,
  {
    // CR-P1 — ban `ReadonlySet<string>` for literal-string sets.
    // Use `ReadonlySet<PhaseName>` (or similar literal union) + `as const`
    // so typos in entries fail at compile time.
    selector:
      'TSTypeReference[typeName.name="ReadonlySet"] > TSTypeParameterInstantiation > TSStringKeyword',
    message:
      '🚫 PIPELINE TYPE: Type literal sets via a string-literal union (e.g. ReadonlySet<PhaseName>) + `as const`, not ReadonlySet<string>. Catches typos at compile time.',
  },
  {
    // CR-P2 — ban `expr as unknown as T` double-casts at API boundaries
    // (extended from Phase H tests to Pipeline production code).
    selector: 'TSAsExpression > TSAsExpression',
    message:
      "🚫 TYPE BYPASS (Pipeline rule): 'expr as unknown as T' double-casts are banned. Express the type via a proper intersection / projector instead.",
  },
  {
    // CR-P3 (V5 — from PR #261 review) — ban `.success === true`
    // / `.success === false` / `.success !== true` / `.success !== false`
    // checks on Procedure values. Use the {@link isOk} helper for
    // consistency with the rest of the call-sites (CodeRabbit found
    // one of these on PhoneFormatter and the canary keeps new
    // occurrences out at pre-commit time).
    //
    // Matches on `right.raw`, NOT `right.value`. esquery applies a regex
    // test only to string values; for a boolean literal `value` is `true`,
    // which no regex matches. The original `[right.value=/^(true|false)$/]`
    // spelling therefore matched exactly one thing — the STRING literal
    // `.success === 'true'` — and never the boolean comparison it exists to
    // ban. It matched nothing in the codebase from the day it was written
    // (PR #261) until 2026-06. `raw` is the source text (`"true"`), so the
    // regex applies as intended. Verified against a fixture AST both ways.
    selector:
      'BinaryExpression[operator=/^[!=]==$/][left.type="MemberExpression"][left.property.name="success"][right.type="Literal"][right.raw=/^(true|false)$/]',
    message:
      '🚫 PROCEDURE: Use `isOk(result)` instead of `result.success === true/false`. Keeps narrowing + call-site consistency aligned across the codebase.',
  },
  {
    // Hand-rolled Procedure literals. `return { success: true, … }` bypasses
    // `succeed()` / `fail()`, so the shape drifts from the discriminated union
    // and the helpers stop being the single place the contract is expressed.
    //
    // Added 2026-06 to give `inline-return-obj.canary.ts` a real target: that
    // canary had certified `ReturnStatement > ObjectExpression`, a selector
    // configured nowhere, and so proved nothing since it was written. The
    // broad form is unusable — 696 legitimate hits across 300 Pipeline files —
    // but narrowing it to the `success` key leaves exactly 4, all inside
    // `Types/Procedure.ts`, which is where the helpers are DEFINED and is
    // exempted below by path.
    //
    // WIDENED 2026-08 after review found two spellings walked straight past it:
    //   `() => ({ success: true })`   — a concise arrow body has no
    //                                   ReturnStatement, so the old selector
    //                                   could not see it.
    //   `return { 'success': true }`  — a Literal key has no `key.name`, so
    //                                   `[key.name="success"]` never matched.
    // Both are ordinary TypeScript a reviewer would not blink at, which made
    // the guard evadable without any intent to evade. Covering the arrow body
    // and the quoted key is a tighten, never a widening of what is allowed
    // (eslint-rules-guidlines.md §1/§4).
    selector:
      ':matches(ReturnStatement, ArrowFunctionExpression) > ObjectExpression > Property:matches([key.name="success"], [key.value="success"])',
    message:
      '🚫 PROCEDURE: Do not hand-roll a Procedure literal. Return `succeed(value)` / `fail(type, message)` from src/Scrapers/Pipeline/Types/Procedure.js so the union has one spelling.',
  },
];

/**
 * Every `no-restricted-syntax` entry that production Pipeline code must carry.
 *
 * Composed here rather than spread at the use site so the contract has exactly
 * one spelling, and so the gate can import the same value ESLint applies. The
 * screenshot ban is folded in because §14 — which used to be its only home —
 * no longer matches Pipeline files.
 *
 * De-duplicated by selector because the legacy and `_NEW` sets overlap: they
 * were written months apart and both re-state `ForInStatement`, the PII log
 * bans, and a dozen others. ESLint rejects options containing two deeply equal
 * entries outright, and two entries sharing a selector but not a message would
 * double-report every hit. Later entries win, so the `_NEW` wording — the
 * newer and more specific of the two — is the one authors see.
 */
const PIPELINE_SYNTAX_RULES = [
  ...new Map(
    [
      ...RESTRICTED_SYNTAX_RULES,
      ...RESTRICTED_SYNTAX_RULES_NEW,
      ...PIPELINE_REVIEW_RULES,
      NO_DIRECT_SCREENSHOT_RULE,
    ]
      .filter(entry => !PIPELINE_SYNTAX_PENDING_DRAIN.has(selectorOf(entry)))
      .map(entry => [selectorOf(entry), entry]),
  ).values(),
];

/**
 * The same contract with NOTHING drained, for the canary directory.
 *
 * A selector on the drain queue is unenforced on production but must still be
 * provably alive, or "queued for drain" silently becomes "deleted": the queue
 * is meant to shrink, and nothing would notice if a queued selector stopped
 * matching. `eslint-rules-guidlines.md` §2 requires a live canary per guardrail
 * — arming the full set here is what lets the queue exist without weakening it.
 *
 * Canaries are fixtures, not shipped code; the violation is the point.
 */
const PIPELINE_CANARY_SYNTAX_RULES = [
  ...new Map(
    [
      ...RESTRICTED_SYNTAX_RULES,
      ...RESTRICTED_SYNTAX_RULES_NEW,
      ...PIPELINE_REVIEW_RULES,
      NO_DIRECT_SCREENSHOT_RULE,
      RULE10_NO_RAW_PAGE_RULE,
      SHAPE_TXNS_WINDOW_END_RULE,
      NO_EXPORT_DEFAULT_RULE,
      TEST_HELPER_OVER_10_STMTS_RULE,
      TEST_INTEGRITY_NO_AS_NEVER_RULE,
    ].map(entry => [selectorOf(entry), entry]),
  ).values(),
];

/**
 * The armed contract, as plain selector strings, for `check-syntax-guardrails`.
 *
 * Exported alongside the default config; ESLint reads only the default export,
 * so this is inert as far as linting is concerned.
 */
export const PIPELINE_ARMED_SELECTORS = PIPELINE_SYNTAX_RULES.map(selectorOf);

/**
 * Per-file, per-selector exemptions from the contract.
 *
 * Declared here rather than expressed as `'no-restricted-syntax': 'off'`
 * because `off` is indiscriminate: it lifts all 61 selectors to excuse one.
 * `PiiRedactor/Types.ts` carried exactly that hammer — the file whose job is
 * defining redaction sentinels ran with no restricted-syntax guardrails at all
 * so that it could hold its own sentinel literals.
 *
 * Keyed by repo-relative path with forward slashes, matching what the gate
 * derives from a walk.
 */
export const PIPELINE_SELECTOR_EXEMPTIONS = {
  // `Procedure.ts` DEFINES `succeed()` / `fail()`, so it is the one place a
  // `{ success: … }` literal is the point rather than a bypass of the helpers.
  //
  // ACCEPTED RISK — this exempts the FILE, not the helper functions. Flat
  // config keys exemptions by path, so there is no way to say "only inside
  // succeed/fail/failWithDetails". `toLegacy` (Procedure.ts) already returns a
  // `{ success: true }` literal typed `IScraperScrapingResult` — not a
  // Procedure at all — and would be a false positive if this exemption were
  // narrowed naively. Telling the two apart needs the returned TYPE, which a
  // syntactic selector cannot see. TARGET: a type-aware custom rule keyed on
  // the return type, after which this entry is DELETED, not widened (§4).
  'src/Scrapers/Pipeline/Types/Procedure.ts': [
    ':matches(ReturnStatement, ArrowFunctionExpression) > ObjectExpression > Property:matches([key.name="success"], [key.value="success"])',
  ],

  // The two files below sit in folders that had been narrowed to a single
  // selector, so they have been escaping the repo-wide legacy set. They are
  // exempted per-selector rather than queued for drain because these rules do
  // apply everywhere else in `src` — queueing them would weaken the whole
  // Pipeline to accommodate a handful of sites (`eslint-rules-guidlines.md` §1).
  //
  // TARGET: drain each in its own commit, then delete its entry here.
  // Two nested calls each, in replay serialisation helpers.
  'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/JsonReplace.ts': [
    "CallExpression > .arguments[type='CallExpression']",
  ],
  'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/RecordShape.ts': [
    "CallExpression > .arguments[type='CallExpression']",
  ],

  // §24 BANK CALENDAR — these files name a LOCAL forensic artefact, not
  // bank-calendar data. Its host-local timestamp is the intended output: a run
  // folder should match the machine clock an operator reads. `TraceStamp.ts`
  // formats the run stamp; `TraceConfig.ts` resolves the folder that uses it.
  // Exempt only the component-read selector; host-zone Date construction stays
  // banned even here.
  'src/Scrapers/Pipeline/Types/TraceConfig.ts': [BANK_CALENDAR_HOST_READ_RULE.selector],
  'src/Scrapers/Pipeline/Types/TraceStamp.ts': [BANK_CALENDAR_HOST_READ_RULE.selector],
  // BankCalendar is the one sanctioned Moment boundary. It pins every parse
  // explicitly; allowing Moment anywhere else would recreate the shared
  // default-zone leak this provider exists to remove.
  'src/Scrapers/Pipeline/Mediator/Scrape/BankCalendar.ts': [BANK_CALENDAR_MOMENT_RULE.selector],
};

/**
 * Selectors that apply to a SUBSET of the Pipeline, on top of the contract.
 *
 * This table exists because the exemption blocks in §23 are emitted last and
 * rebuild `no-restricted-syntax` wholesale. Before it existed they rebuilt from
 * {@link PIPELINE_SYNTAX_RULES} alone, so any selector a narrower block had
 * added was dropped for exactly the files that block targeted. §12C added
 * {@link LOWER_KEYS_ARRAY_RULE} for the canonical-10 folders, and two of the
 * exemption entries — `JsonReplace.ts` and `RecordShape.ts` — sit inside those
 * folders. They are the very files §12C cites as its motivation, so the rule was
 * disarmed precisely where it was aimed.
 *
 * That is the same flat-config replacement hazard the exemption machinery was
 * built to contain, reappearing one layer up. Declaring the scoped selectors
 * once, here, and deriving BOTH the scoped block and the exemption blocks from
 * it means the two cannot drift: there is no second list to forget to update.
 */
export const PIPELINE_SCOPED_SYNTAX_EXTRAS = [
  {
    id: '§12C canonical-10 lookup-array naming',
    files: ['src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/**/*.ts'],
    rules: [LOWER_KEYS_ARRAY_RULE],
  },
];

/**
 * Whether a scoped-extras glob covers a file, for the two shapes we use.
 *
 * Deliberately NOT a general glob engine. It understands a trailing `/**\/*.ts`
 * directory glob and an exact path, and THROWS on anything else. A partial
 * matcher that quietly returned `false` for an unrecognised pattern would
 * reintroduce the silent-disarm bug it exists to prevent, so it fails closed:
 * an exotic glob breaks the config load loudly instead of dropping a selector.
 * @param glob - Pattern from a {@link PIPELINE_SCOPED_SYNTAX_EXTRAS} entry.
 * @param file - Repo-relative, POSIX-separated file path.
 * @returns True when the pattern covers the file.
 * @throws {Error} When the pattern is a shape this matcher cannot decide.
 */
const matchesScopeGlob = (glob, file) => {
  const DIR_GLOB = '**/*.ts';
  if (glob.endsWith(DIR_GLOB)) return file.startsWith(glob.slice(0, -DIR_GLOB.length));
  if (!glob.includes('*')) return file === glob;
  throw new Error(
    `PIPELINE_SCOPED_SYNTAX_EXTRAS: unsupported glob shape ${glob}. ` +
      'Extend matchesScopeGlob deliberately — do not let it fall through.',
  );
};

/**
 * The scoped selectors that apply to one file.
 * @param file - Repo-relative, POSIX-separated file path.
 * @returns Selector entries contributed by every matching scope.
 */
const scopedExtrasFor = file =>
  PIPELINE_SCOPED_SYNTAX_EXTRAS.filter(scope =>
    scope.files.some(glob => matchesScopeGlob(glob, file)),
  ).flatMap(scope => scope.rules);

/**
 * Scoped selector strings that must resolve on a file, for the gate.
 *
 * Exported so `check-syntax-guardrails` expects scoped selectors using THIS
 * matcher rather than reimplementing the glob semantics. A second copy of the
 * matching logic is how the scoped rule got dropped in the first place.
 * @param file - Repo-relative, POSIX-separated file path.
 * @returns Selector strings every matching scope contributes.
 */
export const scopedSelectorsForFile = file => scopedExtrasFor(file).map(selectorOf);

/**
 * The full contract for one file, minus the selectors it is exempt from.
 *
 * Every Pipeline-scoped block must spread {@link PIPELINE_SYNTAX_RULES} before
 * its own selectors. Writing a bare selector list instead is what disarmed the
 * tree: flat config replaces rule options wholesale, so a block declaring one
 * extra selector silently *removes* the other sixty for the files it matches.
 * Four blocks did precisely that — the scrape canonical folders dropped to one
 * selector, the PII redactor cluster to four, and `PiiRedactor/ErrorLog.ts`, a
 * security-classified always-redact module, to one.
 *
 * §8a already carried a comment describing this exact hazard after a review
 * cycle caught it there; the lesson was applied to that one block and never
 * generalised. `check-syntax-guardrails` now generalises it by resolving the
 * real config per file instead of trusting the source to read correctly.
 * @param exempt - Selector strings to drop, from the exemption table.
 * @param file - The file this block targets, so scoped selectors survive.
 * @returns Rule options with the exempt selectors removed.
 */
const pipelineSyntaxExcept = (exempt, file) => [
  'error',
  ...[...PIPELINE_SYNTAX_RULES, ...scopedExtrasFor(file)].filter(
    entry => !exempt.includes(selectorOf(entry)),
  ),
];

/**
 * The drain queue, exported so the gate can prove every entry is real.
 *
 * Without this check a mistyped entry would silently fail to match anything,
 * leaving the selector armed — or worse, a future edit could park a live
 * selector here under a typo and never be noticed.
 */
export const PIPELINE_PENDING_DRAIN_SELECTORS = [...PIPELINE_SYNTAX_PENDING_DRAIN];

/**
 * Selectors that may legitimately be queued for drain.
 *
 * Deliberately excludes `RESTRICTED_SYNTAX_RULES`: those are enforced across
 * all of `src`, so queueing one would carve a Pipeline-shaped hole in a rule
 * the rest of the tree still obeys — a weakening, which
 * `eslint-rules-guidlines.md` §1 forbids.
 */
export const PIPELINE_KNOWN_NEW_SELECTORS = [
  ...RESTRICTED_SYNTAX_RULES_NEW,
  ...PIPELINE_REVIEW_RULES,
].map(selectorOf);

/** Every selector a canary fixture is guaranteed to have armed. */
export const PIPELINE_CANARY_SELECTORS = PIPELINE_CANARY_SYNTAX_RULES.map(selectorOf);

/**
 * Selectors enforced across all of `src` — never legitimately drainable.
 *
 * `PIPELINE_KNOWN_NEW_SELECTORS` documents that these are excluded from the
 * drain queue, but a docblock cannot enforce itself: the two sets are built
 * from different arrays that nothing stops from converging on the same
 * selector string. Exported so the guardrail gate can assert the exclusion
 * instead of trusting it (`eslint-rules-guidlines.md` §1 — tighten, never
 * weaken).
 */
export const PIPELINE_LEGACY_SELECTORS = RESTRICTED_SYNTAX_RULES.map(selectorOf);

export {
  PIPELINE_SYNTAX_RULES,
  PIPELINE_CANARY_SYNTAX_RULES,
  pipelineSyntaxExcept,
  selectorOf,
};
