// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import jest from 'eslint-plugin-jest';
import jsdoc from 'eslint-plugin-jsdoc';
import regexpPlugin from 'eslint-plugin-regexp';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import { SKIP_ALLOWLIST_FILES, SONAR_PARITY_IGNORE_GLOBS } from './eslint.canary-scope.mjs';

/**
 * GLOBAL ARCHITECTURAL GUARDRAILS
 * These apply to all source files to ensure a "Zero-Skip" and Security-First environment.
 */
const RESTRICTED_SYNTAX_RULES = [
  // 1. Coverage Bypasses
  {
    selector:
      "Program > Block:matches([value*='istanbul ignore'], [value*='c8 ignore'], [value*='v8 ignore'])",
    message: '🚫 COVERAGE SKIP: Write a test instead of ignoring coverage.',
  },

  // 2. Lint Bypasses
  {
    selector: "Line:matches([value*='eslint-disable'])",
    message: '🚫 LINT SKIP: Do not disable ESLint rules. Fix the underlying issue.',
  },

  // 3. Type Bypasses (Non-null assertions)
  {
    selector: 'TSNonNullExpression',
    message:
      '🚫 TYPE SKIP: Do not use non-null assertions (!). Use optional chaining (?.) or a proper null check.',
  },

  // 4. Return Value Integrity (Blocking null & undefined returns)
  //
  // Method coverage is deliberately absent here. These two selectors once named
  // `TSMethodDefinition`, which is not a node typescript-eslint ever emits (the
  // real names are `MethodDefinition` / `TSAbstractMethodDefinition` /
  // `TSMethodSignature`), so that branch matched nothing while reading as
  // coverage. The corrected, method-aware spellings live in
  // `PIPELINE_SYNTAX_PENDING_DRAIN` and are armed when their sites are drained;
  // naming the dead node here too would claim the same coverage twice and
  // silently pre-empt that decision.
  {
    // Blocks 'null' or 'undefined' in Type Annotations for functions
    selector:
      ":matches(TSFunctionType, FunctionDeclaration) TSTypeAnnotation :matches(Identifier[name='null'], Identifier[name='undefined'], TSNullKeyword, TSUndefinedKeyword)",
    message:
      "🚫 ARCHITECTURE: Functions cannot return 'null' or 'undefined'. Use a Result Pattern (e.g., IScraperResult).",
  },
  {
    // Blocks 'void' as a return type (Forces every function to return data)
    selector: ':matches(TSFunctionType, FunctionDeclaration) TSTypeAnnotation > TSVoidKeyword',
    message:
      "🚫 ARCHITECTURE: 'void' is forbidden. Every function must return a meaningful value or status object.",
  },
  // Blocks 'return null;', 'return undefined;', and empty 'return;'
  {
    selector:
      "ReturnStatement[argument=null], ReturnStatement[argument.type='Literal'][argument.value=null], ReturnStatement[argument.type='Identifier'][argument.name='undefined']",
    message:
      '🚫 LOGIC: Forbidden return value. Functions must explicitly return a valid object or primitive.',
  },

  // 5. Nested Logic & Readability
  {
    // Targets: print(cal(2,3)) - Nested function calls
    selector: "CallExpression > .arguments[type='CallExpression']",
    message:
      '🚫 FORBIDDEN NESTED CALL: Assign the nested function result to a descriptive variable first for better debugging.',
  },
  {
    selector: "CallExpression[callee.property.name='isStuckOnLoginPage']",
    message: "🚫 FORBIDDEN METHOD: Usage of 'isStuckOnLoginPage' is globally banned.",
  },
  // Note: the `getDebug(import.meta.url)` Architectural Force lives in
  // RESTRICTED_SYNTAX_RULES_NEW (Pipeline-scoped). Common/legacy scrapers call
  // `getDebugByName` (imported from the canonical Logging/Debug.js, usually
  // aliased to `getDebug`) with a verbatim name and are intentionally exempt.

  // 6. Security & Logging
  {
    selector:
      "CallExpression[callee.object.name='logger'] Property[key.name=/password|token|secret|auth|creditCard/i]",
    message: 'SECURITY: Do not log sensitive data keys.',
  },
  {
    selector: "ThrowStatement > NewExpression[callee.name='Error']",
    message:
      "Do not use 'throw new Error()'. Use a custom Error class (e.g., 'throw new ScraperError()') for PII safety.",
  },

  {
    //Blocks 'unknown' in variable type annotations
    selector: 'VariableDeclarator > TSTypeAnnotation TSUnknownKeyword',
    message:
      "🚫 TYPE SKIP: Do not declare variables as 'unknown'. Cast them to a concrete type immediately.",
  },
  // Procedure caller: do not discard Procedure results
  {
    selector:
      'ExpressionStatement > CallExpression[callee.property.name=/^(record|printSummary|sendSummary|sendError|sendMessage|startImport|cleanOldLogs)$/]',
    message:
      '🚫 PROCEDURE: Do not discard Procedure result. Check with isSuccess()/isFail() or assign to variable.',
  },

  // Block: for-in loops (can be used to bypass iterators and cause prototype pollution)
  'ForInStatement',
  'LabeledStatement',
  'WithStatement',

  // 8. Anti-Sleep Policy
  {
    // Targets: sleep(1000), await sleep(1000)
    selector: "CallExpression[callee.name='sleep']",
    message: "🚫 BRITTLE LOGIC: 'sleep()' is forbidden. Use a proper 'waitFor' mechanism.",
  },
  {
    // Targets: setTimeout(() => {}, 1000) - often used as a manual sleep
    selector: "CallExpression[callee.name='setTimeout'][arguments.length=2]",
    message: "🚫 BRITTLE LOGIC: Manual 'setTimeout' delays are forbidden.",
  },
  {
    // Targets: delay(1000) - common in some utility libs
    selector: "CallExpression[callee.name='delay']",
    message: "🚫 BRITTLE LOGIC: 'delay()' is forbidden.",
  },

  // 9. Obfuscation & Naming
  {
    // Targets: { original: shortAlias }
    selector:
      "VariableDeclarator > ObjectPattern > Property[kind='init'][value.name.length<3], ArrowFunctionExpression > ObjectPattern > Property[kind='init'][value.name.length<3]",
    message: '🚫 OBFUSCATION: Do not use short aliases. Use descriptive names.',
  },
  {
    // Prevents generic descriptions like 'test', 'run', or 'batch'
    selector: "CallExpression[callee.name='describe'] > Literal[value=/^(test|run|batch|suite)/i]",
    message: '🚫 GENERIC DESCRIPTION: Use the Feature Name in the describe block.',
  },
  {
    // Phase 7 — T7.10: per-bank `describe('<Phase>.<bank>')` duplication anti-pattern.
    // Matches a literal of shape `<Word>.<bank>` where <bank> is one of the 19
    // CompanyTypes enum values (exact casing — most are lowercase but `visaCal`,
    // `oneZero`, `otsarHahayal`, `payBox`, `beyahadBishvilha` are camelCase per
    // `src/Definitions.ts`). Forces consolidation via `it.each(BANKS)` (from
    // `src/Tests/Helpers/banks.ts`). Does NOT block bank-as-feature-name
    // describes (e.g. `describe('Hapoalim WAF challenge')`) because they start
    // with the bank name itself, not `<Phase>.<bank>`.
    selector:
      "CallExpression[callee.name='describe'] > Literal[value=/^[A-Z][A-Za-z0-9]*\\.(hapoalim|discount|max|visaCal|isracard|amex|beinleumi|oneZero|pepper|mizrahi|mercantile|otsarHahayal|yahav|leumi|massad|pagi|behatsdaa|beyahadBishvilha|payBox)$/]",
    message:
      "🚫 PHASE-7 DIAMOND: per-bank duplication detected. Use it.each(BANKS) from 'src/Tests/Helpers/banks.ts' instead of describe('<Phase>.<bank>'). Bank is an input row, not a suite name.",
  },

  // 10. PII Log Bypass Prevention (T09 + T16) — belt-and-suspenders to PiiRedactor.
  //     T09: PII identifier interpolated into LOG.* template literal.
  //
  //     `errorMessage` added 2026-05-17 (CodeQL #28 root cause). The
  //     Pino censor only operates on STRUCTURED PAYLOAD (the object
  //     argument), so values interpolated into the `msg` string
  //     argument bypass redaction entirely. T09 + T09b + T09c below
  //     are the static-analysis safety net.
  {
    selector:
      "CallExpression[callee.object.name='LOG'][callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] TemplateLiteral Identifier[name=/^(accountId|cardNumber|phoneNumber|israeliId|firstName|lastName|fullName|customerName|otpCode|password|pinCode|nationalId|MisparZihuy|otpLongTermToken|otpToken|idToken|userName|UserName|email|cookie|setCookie|errorMessage)$/]",
    message:
      '🚫 PII LEAK (T09): Variables with PII names cannot be embedded in LOG template literals. Route through PiiRedactor (redactAccount, redactPhone, redactName, redactToken, redactErrorMessage, ...).',
  },
  //     T09b: MemberExpression `${x.errorMessage}` interpolated into ANY
  //     logger callee (LOG.*, bankLog.*, this.bankLog.*, logger.*). The
  //     central Pino censor cannot intercept these — the value is
  //     already a concatenated string by the time it reaches the
  //     transport. Closes CodeQL #28-class leaks. Added 2026-05-17.
  {
    selector:
      'CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] TemplateLiteral MemberExpression[property.name=/^(errorMessage|password|otpCode|idToken|otpToken|otpLongTermToken|cookie|setCookie)$/]',
    message:
      '🚫 PII LEAK (T09b): Member-access expression with credential-class property name interpolated into a logger template literal. The central Pino censor only operates on STRUCTURED payload — values in the `msg` argument bypass redaction. Route through PiiRedactor (redactErrorMessage, redactToken, redactCookie, ...).',
  },
  //     T09c: PII identifier name interpolated into any logger callee
  //     (not just LOG.*). Catches `bankLog.info(...)`, `logger.warn(...)`,
  //     `this.bankLog.info(...)` etc. Added 2026-05-17.
  {
    selector:
      'CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] TemplateLiteral Identifier[name=/^(accountId|cardNumber|phoneNumber|israeliId|otpCode|password|pinCode|nationalId|MisparZihuy|otpLongTermToken|otpToken|idToken|cookie|setCookie|errorMessage)$/]',
    message:
      '🚫 PII LEAK (T09c): Credential-class identifier embedded in a logger template literal. The Pino censor cannot intercept values in the `msg` string. Route through PiiRedactor.',
  },
  //     T09d: sensitive scraper-error-enum members interpolated into a
  //     logger template literal. Closes CodeQL #28 in depth — the
  //     `errorType` discriminated-union tag (e.g. `ScraperErrorTypes
  //     .InvalidPassword`, `LOGIN_RESULTS.ChangePassword`) is
  //     password-class metadata; an attacker scraping logs can pivot
  //     on its presence. Spec.txt §1 RC-1: extends the T09 family
  //     instead of introducing a parallel custom-rule plugin per
  //     `general-rules-guidlines.md` "Prefer extending existing
  //     systems over creating parallel systems." Route through
  //     `redactSensitiveEnum` from PiiRedactor.
  {
    selector:
      'CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] TemplateLiteral MemberExpression[object.name=/^(ScraperErrorTypes|LOGIN_RESULTS|LoginResults)$/][property.name=/^(InvalidPassword|ChangePassword|INVALID_PASSWORD|CHANGE_PASSWORD)$/]',
    message:
      '🚫 PII LEAK (T09d): Sensitive scraper-error-enum value (InvalidPassword/ChangePassword) interpolated into a logger template literal. Route through `redactSensitiveEnum` from PiiRedactor — closes CodeQL #28.',
  },
  //     T16a: forbidden payload key with object/array/spread RHS in LOG.*.
  {
    selector:
      "CallExpression[callee.object.name='LOG'][callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] ObjectExpression > Property[key.name=/^(result|accounts|transactions|txns|scrapeOutput|rawTxn|rawAccount|rawAccounts|rawTxns)$/][value.type=/^(ObjectExpression|ArrayExpression|SpreadElement)$/]",
    message:
      '🚫 PII LEAK (T16): Do not pass object/array payloads under result/accounts/transactions keys. Pass scalar counts/status only (e.g. `txns: count` where count is a string|number).',
  },
  //     T16b: forbidden payload-named identifier as LOG value.
  {
    selector:
      "CallExpression[callee.object.name='LOG'][callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] ObjectExpression > Property[value.type='Identifier'][value.name=/^(scrapeOutput|rawTxn|rawAccount|rawAccounts|rawTxns|fullAccounts|allTxns|accountsArr|txnsArr)$/]",
    message:
      '🚫 PII LEAK (T16): Identifier with payload-shape name passed as LOG value. Pre-redact via PiiRedactor or pass scalar.',
  },
];

// PII Screenshot Bypass Prevention — added 2026-05-21 after CI artifact
// 7128234088 leaked 18+ post-auth PNGs (PR #248, run 26207506594).
// Bans direct `page.screenshot(...)` outside the central SafeScreenshot
// helper, which short-circuits in CI. Applied via a dedicated files
// block below so the helper itself + tests remain allow-listed.
const NO_DIRECT_SCREENSHOT_RULE = {
  selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="screenshot"]',
  message:
    'page.screenshot(...) — use safeScreenshot() from src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts (PII-safe CI gate). The former src/Common/SafeScreenshot.ts shim has been removed; import the canonical Pipeline path.',
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

// §8e: balance resolution belongs to BALANCE-RESOLVE, so the literal must not
// creep back into the SCRAPE data assembler.
const NO_BALANCE_LITERAL_RULE = {
  selector: "Literal[value='balance']",
  message:
    "🚫 V5 ISOLATION (T50): The literal 'balance' is forbidden in ScrapeDataActions.ts. Balance resolution belongs to the BALANCE-RESOLVE phase.",
};

// §8g: an unwrapped `await api.fetch*` rejects the surrounding `Promise.all`,
// so one bank account's network failure aborts every sibling fetch.
const BALANCE_QUARANTINE_RULE = {
  selector: 'AwaitExpression > CallExpression[callee.property.name=/^fetch(Post|Get)$/]',
  message:
    '🚫 BALANCE-RESOLVE QUARANTINE (CR #264 Critical): wrap `await api.fetch*` in safeIssueOneFetch (try/catch) so a thrown fetch cannot abort the Promise.all loop and break per-bank-account quarantine.',
};

// §8h: the bulk-key sentinel lives in BalanceFetchPlanner; hardcoded copies
// drift silently when it is renamed.
const BALANCE_BULK_LITERAL_RULE = {
  selector: "Literal[value='__BULK__']",
  message:
    "🚫 BALANCE-RESOLVE CONSTANTS (CR #264 Major): use the named BULK_KEY constant imported from BalanceFetchPlanner instead of the hardcoded '__BULK__' literal.",
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

// §19.10 TEST-HELPER LINE CAP — fires on any
// `function foo() { ...12+ lines }` inside the Phase 9 files. Complements
// §19.9 (which counts statements only). CR cycle 2 exposed the gap:
// a helper of 21 lines / 5 statements slipped through §19.9 because the
// AST selector grammar cannot compute `loc.end.line - loc.start.line`.
//
// Implemented as a tiny inline plugin (ESLint v9 flat-config supports
// this via `plugins: { 'phase9-local': ... }`) because the built-in
// `max-lines-per-function` rule cannot filter by AST node type, and
// enabling it globally on `src/Tests/**` would fire on every long
// `describe`/`it` arrow callback (3,049 violators per AST audit).
//
// Scope: Phase 9's 6 touched files only. A future "Phase 10 — Tests
// strict 10/10" master plan extends the `files:` glob in waves
// (analogous to §19.1→§19.5 grandfather drains in production).
const phase9LocalPlugin = {
  meta: { name: 'phase9-local', version: '1.0.0' },
  rules: {
    'fn-declaration-max-lines': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'Cap named FunctionDeclaration bodies by total line count (excludes arrow callbacks of describe/it/it.each).',
        },
        messages: {
          tooLong:
            "🚫 §19.10 TEST HELPER LINE CAP: Named test helper '{{name}}' is {{lines}} lines (max {{max}}). Extract focused sub-helpers (Extract Function). Arrow callbacks of describe/it/it.each are exempt (only FunctionDeclaration fires).",
        },
        schema: [
          {
            type: 'object',
            properties: { max: { type: 'integer', minimum: 1 } },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const max = (context.options[0] && context.options[0].max) || 10;
        return {
          FunctionDeclaration(node) {
            if (!node.id || !node.loc) return;
            const lines = node.loc.end.line - node.loc.start.line + 1;
            if (lines > max) {
              context.report({
                node,
                messageId: 'tooLong',
                data: { name: node.id.name, lines: String(lines), max: String(max) },
              });
            }
          },
        };
      },
    },
  },
};

// §19.10 enforcement scope — Phase 9 6 files + Phase 10 wave 1 (Integration).
// PR-A2.1 cycle 4c (CodeRabbit follow-up): the Mode A/B harvester +
// simulator landed under `src/Tests/Integration/**`. CR cycle 4b flagged
// 17 helper functions over the 10-line cap that §19.10 would have
// caught at lint time — but the directory was not in this allowlist.
// Extending the glob enforces the cap going forward on every new file
// under that subtree.
const PHASE_9_TEST_FILES = [
  'src/Tests/E2eReal/Helpers.ts',
  'src/Tests/E2eReal/Tools/CaptureInvalidLogin.ts',
  'src/Tests/Tools/probe-beinleumi-nth.ts',
  'src/Tests/Unit/Pipeline/Infrastructure/DashboardPhase.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryFactoryTest.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/BalanceResolve/BalanceResolveCrossBank.test.ts',
];

// Phase 10 wave 1 — Mode A/B harvester + simulator tree. Glob form so
// future Integration files inherit the cap automatically.
const PHASE_10_INTEGRATION_FILES = [
  'src/Tests/Integration/**/*.ts',
  'src/Tests/Unit/Integration/**/*.ts',
];

// Phase 10 wave 2 — Pipeline coverage-closeout tests (PR #336 Seq #1).
// Closes the gap CR cycle PR #336 #1 exposed: `buildEndpoint` shipped
// at 12 LoC inside `ApiOriginDiscovery.test.ts`, but §7's broad
// `src/Tests/**` override at line 866 turns `max-lines-per-function`
// OFF entirely, so the ≤10-LoC cap from CLEAN_CODE.md §1 + CLAUDE.md
// (Max 10 lines per method) was unenforceable. This wave re-arms the
// cap on NEW pipeline-mirroring tests via:
//   • `phase9-local/fn-declaration-max-lines:10` — line-count guard on
//     `FunctionDeclaration` only. The built-in `max-lines-per-function`
//     and `max-statements` rules are deliberately NOT added because they
//     fire on every `describe`/`it`/`beforeEach` arrow callback (see
//     §19.10 docstring — ~3 049 violators across `src/Tests/**`).
//   • Statement-count enforcement on named helpers already comes from
//     `TEST_HELPER_OVER_10_STMTS_RULE` wired into §7's `no-restricted-
//     syntax` block at line 877 — no new `max-statements` override is
//     needed here.
// Globs are deliberately narrow: the touched files + their immediate
// directories. A future "wave 3" widens to all `src/Tests/Unit/Pipeline/**`
// after the existing 2 317 violators are drained (Phase 9-style sweep).
const PHASE_10_WAVE_2_PIPELINE_HARDENING_TESTS = [
  'src/Tests/Unit/Pipeline/Mediator/Network/MethodBundles.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/Network/Scoring/**/*.test.ts',
  'src/Tests/Unit/Pipeline/Types/PiiRedactor/JsonBody.test.ts',
];

const RESTRICTED_SYNTAX_RULES_NEW = [
  // 1. Coverage Bypasses
  {
    selector:
      "Program > Block:matches([value*='istanbul ignore'], [value*='c8 ignore'], [value*='v8 ignore'])",
    message: '🚫 COVERAGE SKIP: Write a test instead of ignoring coverage.',
  },

  // 2. Lint Bypasses
  {
    selector: "Line:matches([value*='eslint-disable'])",
    message: '🚫 LINT SKIP: Do not disable ESLint rules. Fix the underlying issue.',
  },

  // 3. Type Bypasses (Non-null assertions)
  {
    selector: 'TSNonNullExpression',
    message:
      '🚫 TYPE SKIP: Do not use non-null assertions (!). Use optional chaining (?.) or a proper null check.',
  },

  // 4. Return Value Integrity (Blocking null & undefined returns)
  //
  // The method-aware twins of the two function-only selectors in
  // `RESTRICTED_SYNTAX_RULES`. Both are queued in
  // `PIPELINE_SYNTAX_PENDING_DRAIN` (one site each) rather than armed, so they
  // are the single place method-level return integrity is tracked.
  {
    selector:
      ":matches(TSFunctionType, MethodDefinition, FunctionDeclaration) TSTypeAnnotation :matches(Identifier[name='null'], Identifier[name='undefined'], TSNullKeyword, TSUndefinedKeyword)",
    message:
      "🚫 ARCHITECTURE: Functions cannot return 'null' or 'undefined'. Use a Result Pattern (e.g., IScraperResult).",
  },
  {
    selector:
      ':matches(TSFunctionType, MethodDefinition, FunctionDeclaration) TSTypeAnnotation > TSVoidKeyword',
    message:
      "🚫 ARCHITECTURE: 'void' is forbidden. Every function must return a meaningful value or status object.",
  },

  // Blocks 'return null;', 'return undefined;', and empty 'return;'
  {
    selector:
      "ReturnStatement[argument=null], ReturnStatement[argument.type='Literal'][argument.value=null], ReturnStatement[argument.type='Identifier'][argument.name='undefined']",
    message:
      '🚫 LOGIC: Forbidden return value. Functions must explicitly return a valid object or primitive.',
  },

  // 5. Nested Logic & Readability
  {
    selector: "CallExpression > .arguments[type='CallExpression']",
    message:
      '🚫 FORBIDDEN NESTED CALL: Assign the nested function result to a descriptive variable first for better debugging.',
  },
  {
    selector: "CallExpression[callee.property.name='isStuckOnLoginPage']",
    message: "🚫 FORBIDDEN METHOD: Usage of 'isStuckOnLoginPage' is globally banned.",
  },
  {
    // Architectural Force: getDebug must be called with `import.meta.url` —
    // never a string literal. Logger names are derived from the source
    // filename automatically, no manual config anywhere.
    selector: "CallExpression[callee.name='getDebug'] > Literal:first-child",
    message:
      '🚫 ARCHITECTURE: getDebug() must be called with `import.meta.url`. Logger names are derived from the source filename — no manual strings.',
  },
  {
    selector: "CallExpression[callee.name='getDebug'] > TemplateLiteral:first-child",
    message:
      '🚫 ARCHITECTURE: getDebug() must be called with `import.meta.url`, not a template string.',
  },

  // 6. Security & Logging
  {
    selector:
      "CallExpression[callee.object.name='logger'] Property[key.name=/password|token|secret|auth|creditCard/i]",
    message: 'SECURITY: Do not log sensitive data keys.',
  },
  {
    selector: "ThrowStatement > NewExpression[callee.name='Error']",
    message:
      "Do not use 'throw new Error()'. Use a custom Error class (e.g., 'throw new ScraperError()') for PII safety.",
  },

  // 7. Type Safety
  {
    selector: 'VariableDeclarator > TSTypeAnnotation TSUnknownKeyword',
    message:
      "🚫 TYPE SKIP: Do not declare variables as 'unknown'. Cast them to a concrete type immediately.",
  },

  // Procedure caller: do not discard Procedure results
  {
    selector:
      'ExpressionStatement > CallExpression[callee.property.name=/^(record|printSummary|sendSummary|sendError|sendMessage|startImport|cleanOldLogs)$/]',
    message:
      '🚫 PROCEDURE: Do not discard Procedure result. Check with isSuccess()/isFail() or assign to variable.',
  },

  // 8. Block Legacy Structures
  'ForInStatement',
  'LabeledStatement',
  'WithStatement',

  // 9. Anti-Sleep Policy
  {
    selector: 'CallExpression[callee.name=/^(sleep|delay)$/]',
    message:
      "🚫 BRITTLE LOGIC: 'sleep()' or 'delay()' is forbidden. Use a proper 'waitFor' mechanism.",
  },
  {
    selector: "CallExpression[callee.name='setTimeout'][arguments.length=2]",
    message: "🚫 BRITTLE LOGIC: Manual 'setTimeout' delays are forbidden.",
  },

  // 10. Obfuscation & Naming
  {
    selector:
      "VariableDeclarator > ObjectPattern > Property[kind='init'][value.name.length<3], ArrowFunctionExpression > ObjectPattern > Property[kind='init'][value.name.length<3]",
    message: '🚫 OBFUSCATION: Do not use short aliases. Use descriptive names.',
  },
  {
    selector: "CallExpression[callee.name='describe'] > Literal[value=/^(test|run|batch|suite)/i]",
    message: '🚫 GENERIC DESCRIPTION: Use the Feature Name in the describe block.',
  },
  {
    selector:
      'MethodDefinition[key.name=/^(write|import|send|create|delete)/] ReturnStatement:not([argument])',
    message:
      '🚫 RESULT PATTERN: Side-effect methods (write/import/send/create/delete) must return Procedure, not void.',
  },
  // DI: Block ALL manual instantiation except builtins
  {
    // Add your safe classes to the negative lookahead (the ?! section)
    selector:
      'NewExpression[callee.name=/^(?!Error|Map|Set|Date|RegExp|URL|Headers|EventEmitter|ScraperError|PipelineBuilder|HomePhase|PreLoginPhase|DashboardPhase|ScrapePhase|OtpPhase|TerminatePhase)[A-Z]/]',
    message: '🚫 DI ENFORCEMENT: Do not instantiate classes directly. Inject via PipelineContext.',
  },
  {
    selector: "Line:matches([value*='eslint-disable-next-line'], [value*='eslint-disable-line'])",
    message:
      '🚫 LINT BYPASS: Inline disables are strictly forbidden. Refactor the logic to comply or move it to a dedicated Strategy/Mediator.',
  },
  // Guard Clauses & Logic Flow - No else blocks
  {
    selector: 'IfStatement[alternate]',
    message: "🚫 'else' blocks are disallowed. Use early returns (Guard Clauses).",
  },
  // No ternary — use logical lookups
  {
    selector: 'ConditionalExpression',
    message: '🚫 Ternary operators are disallowed. Use logical lookups.',
  },

  // Result Pattern: No primitive returns (V8 COMPATIBLE)
  {
    selector:
      'MethodDefinition[key.name!=/^(constructor|setup|init)$/] .TSTypeAnnotation :matches(TSStringKeyword, TSNumberKeyword, TSBooleanKeyword)',
    message: '🚫 RESULT PATTERN: Do not return primitives directly. Return an IScraperResult.',
  },

  // Data Integrity & Fallbacks - Guard
  {
    // Targets: const x = y || '';
    // EXEMPTS: variables named text, html, content, val, attr (common in DOM scraping)
    selector:
      "VariableDeclarator[id.name!=/text|html|content|val|attr/i] > LogicalExpression[right.value='']",
    message:
      "🚫 DATA INTEGRITY: Avoid '' fallbacks in business logic. Use a Result or ScraperError.",
  },

  // Pagination Abstraction - Pagination: No manual while loops — use Pagination strategy
  {
    selector: 'WhileStatement, DoWhileStatement',
    message: '🚫 PAGINATION: Do not use manual loops. Use the Pagination strategy abstraction.',
  },

  // Concurrency & Error Handling
  {
    selector: "CallExpression[callee.object.name='Promise'][callee.property.name='any']",
    message: '🚫 CONCURRENCY: Promise.any() swallows errors. Use Promise.allSettled().',
  },
  // GUARD: Prevent transforming Errors into "Empty Success"
  {
    selector:
      "IfStatement[test.argument.property.name='isOk'] ReturnStatement > ArrayExpression[elements.length=0]",
    message:
      '🚫 DATA INTEGRITY: Do not return an empty array [] on failure. Propagate the failure Result.',
  },
  {
    selector: "CatchClause MemberExpression[property.name='message']",
    message: '🚫 ARCHITECTURE: Use toErrorMessage(error) instead of manual .message access.',
  },

  // Hardcoded Values Bypassing DI
  {
    selector: 'Property[key.name=/viewport|width|height|timeout|delay|retries/i] > Literal',
    message: "🚫 DI: Config values must be injected via 'ctx.config'.",
  },
  {
    selector:
      'CallExpression[callee.property.name=/goto|waitForTimeout|setViewport|setTimeout|waitForSelector|click|type/] > Literal',
    message: "🚫 DI: Browser interactions must use selectors/URLs from 'ctx.config'.",
  },
  {
    selector:
      "BinaryExpression[operator='==='] > Literal[value=/^(success|failure|pending|error|done)$/i]",
    message: '🚫 ARCHITECTURE: Use Enums or Constants for status checks.',
  },

  // Type Safety (Unknown Checks - V8 COMPATIBLE)
  {
    selector:
      ':matches(FunctionDeclaration, ArrowFunctionExpression, MethodDefinition) Identifier > TSTypeAnnotation > TSUnknownKeyword',
    message:
      "🚫 ARCHITECTURE: Function parameters cannot be 'unknown'. Define a specific Interface.",
  },
  {
    selector:
      ':matches(FunctionDeclaration, ArrowFunctionExpression, MethodDefinition) > TSTypeAnnotation TSUnknownKeyword',
    message: "🚫 ARCHITECTURE: Functions cannot return 'unknown'. Define a concrete return Type.",
  },
  {
    // Type Bypasses (as never / as any)
    selector: 'TSAsExpression > :matches(TSNeverKeyword, TSAnyKeyword)',
    message:
      "🚫 TEST INTEGRITY: Do not use 'as never' or 'as any' in mocks. Use 'DeepPartial<T>' or implement the required interface.",
  },
  {
    selector:
      "ClassDeclaration[id.name=/Phase$/] MethodDefinition[key.name='execute'] > BlockStatement > ExpressionStatement[expression.type!='CallExpression']",
    message:
      '🚫 ARCHITECTURE: Phase execution is READ-ONLY orchestration. Move logic to a Step/Handler.',
  },

  //  PII Log Bypass Prevention — Pipeline tier.
  //  Identical selectors to RESTRICTED_SYNTAX_RULES so legacy + Pipeline are
  //  both protected. Runtime layer (PiiRedactor) is the single source of
  //  truth for redaction logic; these rules prevent call-sites from
  //  bypassing the runtime by leaking raw PII into Pino payloads.
  //
  //  T09 + T09b + T09c added 2026-05-17 to close CodeQL #28 class
  //  (errorMessage / member-access / wider-callee leaks).
  {
    selector:
      "CallExpression[callee.object.name='LOG'][callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] TemplateLiteral Identifier[name=/^(accountId|cardNumber|phoneNumber|israeliId|firstName|lastName|fullName|customerName|otpCode|password|pinCode|nationalId|MisparZihuy|otpLongTermToken|otpToken|idToken|userName|UserName|email|cookie|setCookie|errorMessage)$/]",
    message:
      '🚫 PII LEAK (T09): Variables with PII names cannot be embedded in LOG template literals. Route through PiiRedactor (redactAccount, redactPhone, redactName, redactToken, redactErrorMessage, ...).',
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] TemplateLiteral MemberExpression[property.name=/^(errorMessage|password|otpCode|idToken|otpToken|otpLongTermToken|cookie|setCookie)$/]',
    message:
      '🚫 PII LEAK (T09b): Member-access expression with credential-class property name interpolated into a logger template literal. The Pino censor cannot intercept values in the `msg` string. Route through PiiRedactor.',
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] TemplateLiteral Identifier[name=/^(accountId|cardNumber|phoneNumber|israeliId|otpCode|password|pinCode|nationalId|MisparZihuy|otpLongTermToken|otpToken|idToken|cookie|setCookie|errorMessage)$/]',
    message:
      '🚫 PII LEAK (T09c): Credential-class identifier embedded in a logger template literal (any callee — bankLog/logger/LOG/this.bankLog/...). The Pino censor cannot intercept values in the `msg` string. Route through PiiRedactor.',
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] TemplateLiteral MemberExpression[object.name=/^(ScraperErrorTypes|LOGIN_RESULTS|LoginResults)$/][property.name=/^(InvalidPassword|ChangePassword|INVALID_PASSWORD|CHANGE_PASSWORD)$/]',
    message:
      '🚫 PII LEAK (T09d): Sensitive scraper-error-enum value interpolated into a logger template literal. Route through `redactSensitiveEnum` from PiiRedactor — closes CodeQL #28.',
  },
  {
    selector:
      "CallExpression[callee.object.name='LOG'][callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] ObjectExpression > Property[key.name=/^(result|accounts|transactions|txns|scrapeOutput|rawTxn|rawAccount|rawAccounts|rawTxns)$/][value.type=/^(ObjectExpression|ArrayExpression|SpreadElement)$/]",
    message:
      '🚫 PII LEAK (T16): Do not pass object/array payloads under result/accounts/transactions keys. Pass scalar counts/status only (e.g. `txns: count` where count is a string|number).',
  },
  {
    selector:
      "CallExpression[callee.object.name='LOG'][callee.property.name=/^(trace|debug|info|warn|error|fatal)$/] ObjectExpression > Property[value.type='Identifier'][value.name=/^(scrapeOutput|rawTxn|rawAccount|rawAccounts|rawTxns|fullAccounts|allTxns|accountsArr|txnsArr)$/]",
    message:
      '🚫 PII LEAK (T16): Identifier with payload-shape name passed as LOG value. Pre-redact via PiiRedactor or pass scalar.',
  },
];

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
  'NewExpression[callee.name=/^(?!Error|Map|Set|Date|RegExp|URL|Headers|EventEmitter|ScraperError|PipelineBuilder|HomePhase|PreLoginPhase|DashboardPhase|ScrapePhase|OtpPhase|TerminatePhase)[A-Z]/]',
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
  // SafeScreenshot is the one sanctioned `page.screenshot()` call site: it
  // short-circuits in CI so rendered bank pixels stay out of public-readable
  // artifacts (PR #248 leaked 18+ post-auth PNGs). Exempting the selector on
  // this file alone keeps every other selector enforced on it.
  'src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts': [NO_DIRECT_SCREENSHOT_RULE.selector],

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

  // The three files below sit in folders that had been narrowed to a single
  // selector, so they have been escaping the repo-wide legacy set. They are
  // exempted per-selector rather than queued for drain because these rules do
  // apply everywhere else in `src` — queueing them would weaken the whole
  // Pipeline to accommodate seven sites (`eslint-rules-guidlines.md` §1).
  //
  // TARGET: drain each in its own commit, then delete its entry here.
  // `snapshotBalancePool` returns `readonly unknown[] | undefined` and signals
  // "no mediator / empty pool" with `undefined`; collapsing that onto a Result
  // changes what BALANCE-RESOLVE observes, so it needs its own tests.
  'src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhase/PhaseActions.ts': [
    ":matches(TSFunctionType, FunctionDeclaration) TSTypeAnnotation :matches(Identifier[name='null'], Identifier[name='undefined'], TSNullKeyword, TSUndefinedKeyword)",
    "ReturnStatement[argument=null], ReturnStatement[argument.type='Literal'][argument.value=null], ReturnStatement[argument.type='Identifier'][argument.name='undefined']",
  ],
  // Two nested calls each, in replay serialisation helpers.
  'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/JsonReplace.ts': [
    "CallExpression > .arguments[type='CallExpression']",
  ],
  'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/RecordShape.ts': [
    "CallExpression > .arguments[type='CallExpression']",
  ],
};

/**
 * Selectors that apply to a SUBSET of the Pipeline, on top of the contract.
 *
 * This table exists because the exemption blocks in §23 are emitted last and
 * rebuild `no-restricted-syntax` wholesale. Before it existed they rebuilt from
 * {@link PIPELINE_SYNTAX_RULES} alone, so any selector a narrower block had
 * added was dropped for exactly the files that block targeted. §12C added
 * {@link LOWER_KEYS_ARRAY_RULE} for the canonical-10 folders, and three of the
 * five exemption entries — `PhaseActions.ts`, `JsonReplace.ts`, `RecordShape.ts`
 * — sit inside those folders. The last two are the very files §12C cites as its
 * motivation, so the rule was disarmed precisely where it was aimed.
 *
 * That is the same flat-config replacement hazard the exemption machinery was
 * built to contain, reappearing one layer up. Declaring the scoped selectors
 * once, here, and deriving BOTH the scoped block and the exemption blocks from
 * it means the two cannot drift: there is no second list to forget to update.
 */
export const PIPELINE_SCOPED_SYNTAX_EXTRAS = [
  {
    id: '§12C canonical-10 lookup-array naming',
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhase/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/FrozenScrapeAction.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/UrlDateRange.ts',
    ],
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

/**
 * File-specific rule entries a single canary exists to certify.
 *
 * These used to live inline in the production block that owns the rule, with
 * the canary path bolted onto that block's `files`. That spelling is unsafe
 * for the reason this whole section exists: any later block touching the
 * canary directory replaces the options wholesale, and the canary keeps
 * failing — just on some unrelated rule — so nothing reports the loss.
 *
 * Declared here and emitted last (§22a), a canary's extra entry cannot be
 * outranked, and `check-syntax-guardrails.mjs` proves each one resolves.
 */
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

const CANARY_EXTRA_RULES = {
  // §8e: `ScrapePhase.ts` must not emit a `balance:` literal.
  'src/Scrapers/Pipeline/EslintCanaries/no-balance-in-scrape.canary.ts': [NO_BALANCE_LITERAL_RULE],
  // §8g: BALANCE-RESOLVE fetches must stay quarantined in a try block.
  'src/Scrapers/Pipeline/EslintCanaries/balance-resolve-throw-leaks-quarantine.canary.ts': [
    BALANCE_QUARANTINE_RULE,
  ],
  // §8h: the `'__BULK__'` sentinel must be imported, never re-typed.
  'src/Scrapers/Pipeline/EslintCanaries/balance-resolve-bulk-literal.canary.ts': [
    BALANCE_BULK_LITERAL_RULE,
  ],
  // §8i: `balance ?? 0` / `?? null` collapses unknown into a real value.
  'src/Scrapers/Pipeline/EslintCanaries/balance-default-zero.canary.ts':
    BALANCE_DEFAULT_DENY_RULES,
  // §12C: `lower*Keys` implies membership testing — use a Set.
  'src/Scrapers/Pipeline/EslintCanaries/scrape-canonical10-lookup-array-shouldbe-set.canary.ts': [
    LOWER_KEYS_ARRAY_RULE,
  ],
  // §13: redaction sentinels are defined once in `PiiRedactor/Types.ts`.
  'src/Scrapers/Pipeline/EslintCanaries/pii-hardcoded-sentinel.canary.ts':
    PII_SENTINEL_LITERAL_RULES,
  // §13C: `ErrorLog.ts` must always-redact; the canary proves the ban fires.
  'src/Scrapers/Pipeline/EslintCanaries/pii-errorlog-bypass.canary.ts': [
    PII_ERRORLOG_NO_BYPASS_RULE,
  ],
};

/** `canary path → selector[]`, for the gate. Derived so the two cannot drift. */
export const CANARY_EXTRA_SELECTORS = Object.fromEntries(
  Object.entries(CANARY_EXTRA_RULES).map(([file, rules]) => [file, rules.map(selectorOf)]),
);

/**
 * `canary path → message[]` for the rules a canary was written to certify.
 *
 * A canary given a file-specific rule exists for that rule and nothing else, so
 * this map is ground truth for its subject. The harness asserts the canary
 * declares one of these messages: a fixture usually trips bystander selectors
 * too, and declaring a bystander certifies the wrong guardrail while still
 * reporting green.
 */
export const CANARY_EXTRA_MESSAGES = Object.fromEntries(
  Object.entries(CANARY_EXTRA_RULES).map(([file, rules]) => [
    file,
    rules.map(entry => (typeof entry === 'string' ? '' : entry.message)).filter(Boolean),
  ]),
);

/** Config blocks arming each canary's file-specific rule. Emitted last. */
const CANARY_EXTRA_BLOCKS = Object.entries(CANARY_EXTRA_RULES).map(([file, rules]) => ({
  files: [file],
  rules: {
    'no-restricted-syntax': ['error', ...PIPELINE_CANARY_SYNTAX_RULES, ...rules],
  },
}));

// Phase 3 Common ↔ Pipeline unification guard — Commit 11 (refactor/phase-3-common-unify).
//
// Bans Pipeline production code from importing Common/* (Pipeline is canonical;
// Common is the deprecated re-export shim layer). Uses `regex` (not `group`) so
// the negative lookahead can ALLOWLIST `Common/Config/BrowserConfig`, which is
// browser-bootstrap-only with no Pipeline duplicate. The single canonical
// allowed Pipeline → Common runtime edge: CamoufoxLauncher.ts → BrowserConfig.
//
// Pinning by regex (not file-level `ignores` on CamoufoxLauncher) closes the
// hole rubber-duck flagged in C11 critique Blocking-2: any OTHER Common import
// added to CamoufoxLauncher in the future also fires this rule.
const PHASE3_COMMON_IMPORT_BAN_PATTERN = {
  regex: String.raw`Common/(?!Config/BrowserConfig(?:\.js)?$)`,
  message:
    '🚫 PHASE-3 ARCHITECTURE: Pipeline production code must not import from Common/*. Pipeline is canonical; Common/* is a deprecated re-export shim. Import the symbol from src/Scrapers/Pipeline/Mediator/<Subdir>/<Module>.js instead. Allowlist: Common/Config/BrowserConfig (browser bootstrap-only, no Pipeline duplicate; exact module match, NOT lookalikes like BrowserConfigLegacy).',
};

export default tseslint.config(
  // 1. GLOBAL IGNORES
  {
    ignores: [
      '.github/**',
      'lib/**',
      'node_modules/**',
      'coverage/**',
      'src/coverage/**',
      'tsup.config.ts',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/EslintCanaries/**',
      // Local-only real-credential harnesses (mirror of .gitignore pattern):
      // never linted because they are never committed.
      'src/Tests/**/*.local.test.ts',
    ],
  },

  // 2. BASE CONFIGS
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  regexpPlugin.configs['flat/recommended'],
  prettier,

  // 3. MAIN SOURCE FILES (STRICT)
  {
    files: ['src/**/*.ts'],
    plugins: {
      'import-x': importPlugin,
      'unused-imports': unusedImports,
      'check-file': checkFile,
      'simple-import-sort': simpleImportSort,
      regexp: regexpPlugin,
      jsdoc,
      sonarjs,
      unicorn,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
        ...globals.es2021,
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
      },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'no-console': 'error',
      // §15 declares this same rule for `src/**/*.ts(x)` — the identical glob,
      // later in the array — so flat config replaces these options wholesale
      // rather than merging them. Every term below is also in §15's list,
      // except `todo` and `fixme`, which were therefore unreachable: a probe
      // file carrying both drew zero reports. They are not restored, because
      // the tree deliberately carries nine `TODO (scope): reason` markers in
      // the harvest-milestone fixtures, in the form `comments-in-code-
      // guidlines.md` §9 prescribes. Declaring a ban the tree is built to
      // violate is the claim to drop, not the convention.
      'no-warning-comments': [
        'error',
        {
          terms: [
            'istanbul ignore',
            'c8 ignore',
            'v8 ignore',
            '@ts-ignore',
            '@ts-nocheck',
            '@ts-expect-error',
            'eslint-disable',
            'prettier-ignore',
          ],
          location: 'anywhere',
        },
      ],
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': true,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Imports
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/max-dependencies': ['error', { max: 15, ignoreTypeImports: true }],

      // Style & Return Types
      quotes: ['error', 'single', { avoidEscape: true }],
      // Force explicit 'public', 'private', or 'protected'
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'explicit', overrides: { constructors: 'no-public' } },
      ],
      // Force explicit return types (including : void)
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: false,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      'import-x/prefer-default-export': 'error',
      'no-nested-ternary': 'error',
      'class-methods-use-this': 'error',
      'arrow-body-style': 'off',
      'no-shadow': 'off',
      'no-await-in-loop': 'error',

      // Type Safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // The 19 SonarJS / Unicorn rules that mirror SonarCloud's checks
      // are wired in a dedicated "Pipeline scope" block below (matching
      // the sonar.exclusions list in sonar-project.properties), not
      // here. Tests and legacy scrapers are out of Sonar's scope; we
      // mirror that locally so ESLint and SonarCloud stay aligned.

      // Unused Code
      'no-unused-vars': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],

      // Naming
      'check-file/filename-naming-convention': ['error', { 'src/**/*.{ts,tsx}': 'PASCAL_CASE' }],
      'check-file/folder-naming-convention': ['error', { 'src/**/': 'PASCAL_CASE' }],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: { regex: '^I[A-Z]', match: true },
        },
        { selector: ['variable', 'function', 'method'], format: ['camelCase'] },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['is', 'has', 'should', 'can', 'did', 'will', 'was'],
        },
        {
          selector: 'variable',
          modifiers: ['const', 'global'],
          format: ['UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        {
          selector: 'classProperty',
          modifiers: ['private'],
          format: ['camelCase'],
          leadingUnderscore: 'require',
        },
        { selector: 'typeParameter', format: ['PascalCase'], prefix: ['T'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
      ],
      '@typescript-eslint/member-ordering': [
        'error',
        {
          default: [
            'public-static-field',
            'protected-static-field',
            'private-static-field',
            'public-instance-field',
            'protected-instance-field',
            'private-instance-field',
            'constructor',
            'public-instance-method',
            'protected-instance-method',
            'private-instance-method',
          ],
        },
      ],

      // JSDoc
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
        },
      ],
      'jsdoc/require-description': ['error', { contexts: ['any'] }],
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-param-type': 'off', // TS handles types
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/require-returns-type': 'off', // TS handles types
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',

      // Limits
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/max-params': ['error', { max: 3 }],
      complexity: ['error', { max: 10 }],
      'max-classes-per-file': ['error', 1],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-len': [
        'error',
        { code: 100, ignoreUrls: true, ignoreStrings: true, ignoreComments: true },
      ],
    },
  },

  // 4. TEST / MOCK (RELAXED)
  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'src/Tests/**/*.ts',
      '**/mocks/**/*.ts',
      'eslint.config.mjs',
    ],
    rules: {
      'no-console': 'off', // Allow logging in tests
      'max-lines-per-function': 'off', // Tests are naturally long
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }], // Tests can be longer
      'max-len': 'off', // Test descriptions can be long
      'check-file/filename-naming-convention': 'off', // Allow standard test naming
      // Jest recognises `@jest-environment` as a docblock pragma to switch
      // the test environment per file (e.g. jsdom vs node). It is a real
      // tag from Jest, not a custom invention — whitelist it for tests so
      // jsdoc/check-tag-names does not reject it.
      'jsdoc/check-tag-names': ['error', { definedTags: ['jest-environment'] }],

      //🚨 Prevent the 'as never' / 'as any' bypass in mocks + §19.9 test-helper cap
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES, TEST_HELPER_OVER_10_STMTS_RULE],
    },
  },

  // 5. PIPELINE TESTS: STRUCTURE ENFORCEMENT
  {
    files: ['src/Tests/**/Pipeline/**/*.ts'],
    rules: {
      'class-methods-use-this': 'off', // Test doubles extend SimplePhase with no-op overrides
      'max-classes-per-file': 'off', // Test doubles need multiple classes per file
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              message:
                '🚫 Rule #10: Phases must use the Mediator. Direct Playwright imports are forbidden in Pipeline logic.',
            },
          ],
          patterns: [
            {
              group: ['**/Registry/Config/**'],
              message: '🚫 DI: Use ctx.config — do not import ScraperConfig directly.',
            },
            {
              group: ['**/Common/**'],
              message:
                '🚫 ARCHITECTURE: Pipeline Tests must not reference Common/. Use Pipeline local types/mocks.',
            },
          ],
        },
      ],
      'check-file/filename-naming-convention': [
        'error',
        { 'src/Tests/**/*.{test,spec}.ts': 'PASCAL_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': [
        'error',
        { 'src/Tests/**/Pipeline/**/': 'PASCAL_CASE' },
      ],
      'check-file/folder-match-with-fex': [
        'error',
        { '*.test.ts': '**/(Unit|E2E|Scrapers)/Pipeline/**' },
      ],
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        TEST_INTEGRITY_NO_AS_NEVER_RULE,
        NO_EXPORT_DEFAULT_RULE,
        RULE10_NO_RAW_PAGE_RULE,
        TEST_HELPER_OVER_10_STMTS_RULE,
      ],
    },
  },

  // 6. PIPELINE LOGIC (DI, MEDIATOR, HANDLERS & RESULT PATTERN)
  // 6. PIPELINE LOGIC (STRICT ARCHITECTURAL ENFORCEMENT)
  {
    files: ['src/Scrapers/Pipeline/**/*.ts'],
    plugins: {
      'check-file': checkFile,
      'import-x': importPlugin,
      sonarjs,
    },
    rules: {
      // --- A. THE "NESTED OR DEATH" GATE ---
      'check-file/folder-naming-convention': [
        'error',
        {
          'src/Scrapers/Pipeline/Phases/*/': 'PASCAL_CASE',
          'src/Scrapers/Pipeline/Mediator/*/': 'PASCAL_CASE', // <--- FORCES MEDIATOR SUBFOLDERS
          'src/Scrapers/Pipeline/Strategy/*/': 'PASCAL_CASE', // FORCES SUBFOLDERS
        },
      ],
      'check-file/filename-naming-convention': [
        'error',
        {
          // FORCES THE 4-STAGE LIFECYCLE + MEDIATOR ACTIONS
          'src/Scrapers/Pipeline/Phases/**/*{Pre,Action,Post,Reveal,Step,Phase}.ts': 'PASCAL_CASE',
          'src/Scrapers/Pipeline/Mediator/**/*Action.ts': 'PASCAL_CASE',
          'src/Scrapers/Pipeline/Strategy/**/*Strategy.ts': 'PASCAL_CASE',
        },
      ],

      // --- B. THE GLOBAL ARCHITECTURAL FORCE ---
      // This applies to ALL files in Pipeline, including Mediator and Strategy.
      // CodeRabbit-class selectors (PR #257) appended here so the same
      // patterns are caught at pre-commit time instead of in review.
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES],

      // --- C. DEFAULT COMPLEXITY (STRICT) ---
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 15 }],
      'max-depth': ['error', 1],

      // --- D. PR #261 REVIEW VALIDATORS ---
      // V3 — surface unguarded conditionals that ESLint can statically
      // prove are always-truthy or always-falsy. CodeRabbit caught the
      // `(creds.phoneNumber as unknown as string) ?? ''` pattern this
      // way; the rule keeps future double-cast-then-null-coalesce out.
      '@typescript-eslint/no-unnecessary-condition': 'error',
      // V2 — flag any string literal that repeats 3+ times in one file
      // without being lifted to a named constant. CodeRabbit's CR2 was
      // a hardcoded `'5.6.6'` / `'android-13'` / `'pb'` set at module
      // scope in PayBoxShapeTxns; the rule keeps that class of "magic
      // string trio" out at pre-commit.
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      // V4 — surface dead `await` keywords (CodeRabbit CR9's `await
      // Promise.resolve()` in ApiDirectScrapePhase.post) AND the
      // dual-form bug where `return await` inside try/catch is fine
      // but outside it is wasted work. Both rules complement each
      // other: `no-return-await` covers the syntactic case,
      // `await-thenable` rejects awaits on plain values that can't be
      // a Promise.
      'no-return-await': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  // 7. INFRASTRUCTURE EXCEPTIONS (COMPLEXITY ONLY)
  {
    // These files can be longer, but they MUST still follow Section 6's architecture
    files: ['src/Scrapers/Pipeline/{Mediator,Strategy,Types}/**/*.ts'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      // DO NOT redefine no-restricted-syntax here; let Section 6 handle it.
    },
  },

  // 7b. TYPE-ONLY DOMAIN MODULES — DEFAULT-EXPORT EXEMPTION
  //
  // CodeRabbit feedback on PR #274: scope the
  // `import-x/prefer-default-export` exemption narrowly to the
  // `Types/Domain/**` folder so {Mediator,Strategy,Types-root}
  // files continue to enforce the global rule. A type-only module
  // such as `Domain/BrowserState.ts` that exports a single
  // `interface IBrowserState` has nothing to default-export (a
  // default export is a runtime concept); the rule fires unhelpfully
  // there. Scoping to `Types/Domain/**` keeps the protection where
  // it adds value and removes the over-broad disable.
  //
  // Phase 8.5c / Commit C2 — add the global ≤10-LoC function cap
  // (`max-lines-per-function: 10`) so type-only domain files are
  // measured by the same yardstick as production modules. Type
  // declarations are zero-LoC contributions; helpers and any
  // future runtime code in this folder must fit within 10 LoC.
  {
    files: [
      'src/Scrapers/Pipeline/Types/Domain/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/types-domain-fn-over-10.canary.ts',
    ],
    rules: {
      'import-x/prefer-default-export': 'off',
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 7c. API-DIRECT-CALL CONFIGCONTRACTS — DEFAULT-EXPORT EXEMPTION
  //
  // Phase 8 split: the `ConfigContracts/` sub-tree under
  // `ApiDirectCall/` houses focused, type-only modules carved out of
  // the former IApiDirectCallConfig god-file. Most files re-export
  // multiple symbols, but the top-level composer
  // `ApiDirectCallConfig.ts` legitimately exports a single
  // `interface IApiDirectCallConfig` — and interfaces cannot be
  // default-exported as values. Same rationale as 7b; same narrow
  // scope.
  {
    files: ['src/Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/**/*.ts'],
    rules: {
      'import-x/prefer-default-export': 'off',
    },
  },

  // 7d. TIMING DOMAIN MODULES — DEFAULT-EXPORT EXEMPTION (Phase 12b)
  //
  // Phase 12b (v8.5) split the former 481-LoC
  // `Mediator/Timing/TimingConfig.ts` hub into per-phase domain
  // files (`HomeTimingConfig.ts`, `OtpTimingConfig.ts`, ...). Some
  // phases own exactly one budget — `TerminateTimingConfig.ts` only
  // exposes `TERMINATE_CLEANUP_BUDGET_MS`. Forcing those modules to
  // `export default` would require every importer to bind a local
  // alias for a value that is already named at its declaration site.
  // Narrow scope: timing files only — every
  // other Mediator module still enforces the global rule.
  {
    files: ['src/Scrapers/Pipeline/Mediator/Timing/**/*TimingConfig.ts'],
    rules: {
      'import-x/prefer-default-export': 'off',
    },
  },

  // 8. PHASE ROOT GUARD (THE FINAL CHECK)
  {
    files: ['src/Scrapers/Pipeline/Phases/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PIPELINE_SYNTAX_RULES,
        {
          selector: 'Program',
          message:
            '🚫 ARCHITECTURE: Phase files must reside in a Domain subfolder (e.g., Phases/Login/LoginStep.ts).',
        },
      ],
    },
  },

  // 8b. CANARY — TEST-DUPLICATION SONARJS S4144 (single-file scope)
  //
  // Applies sonarjs/no-identical-functions to the dedicated canary
  // fixture so verify.sh can confirm S4144 fires. The rule is already
  // enabled globally at §11 (Pipeline scope; `src/Tests/**` ignored);
  // this single-file override extends it to the EslintCanaries dir for
  // the duplication canary specifically. No production impact.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/test-suite-duplication.canary.ts'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/no-identical-functions': 'error',
    },
  },

  // 8c. V5 ISOLATION — BALANCE-RESOLVE MUST NOT IMPORT SCRAPE INTERNALS (T49).
  //
  // The v5 phase architecture splits SCRAPE and BALANCE-RESOLVE into
  // disjoint zones. BALANCE-RESOLVE consumes ONLY the typed
  // `scrape.perAccountResponses` field from {@link IPipelineContext};
  // anything deeper (helpers, types, mediator actions) would re-couple
  // the phases and break the single-source-of-truth contract from
  // `general-phases-view-guidlines.md`.
  //
  // Scope covers both the production BalanceResolve zone (so a regression
  // fails pre-commit) AND the dedicated canary file (so verify.sh can
  // confirm the rule still fires).
  {
    files: [
      'src/Scrapers/Pipeline/Phases/BalanceResolve/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.ts',
      'src/Scrapers/Pipeline/EslintCanaries/balance-resolve-isolation.canary.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/Strategy/Scrape/**', '**/Mediator/Scrape/ScrapePhaseActions*'],
              message:
                '🚫 V5 ISOLATION (T49): BALANCE-RESOLVE must not import SCRAPE internals. Read ctx.scrape.perAccountResponses instead.',
            },
            PHASE3_COMMON_IMPORT_BAN_PATTERN,
          ],
        },
      ],
    },
  },

  // 8d. V5 ISOLATION — SCRAPE MUST NOT REFERENCE BALANCE-RESOLVE (T50).
  //
  // Mirror of 8c — guards the SCRAPE zone from leaking back into
  // balance resolution logic. The `Account/BalanceExtractor.ts` shim
  // is excluded because it re-exports from the BalanceResolve module
  // by design (compatibility shim, removed in a later decoupling phase).
  // The canary file lives outside the production scope; it gets the
  // same rule via the second `files:` glob so verify.sh sees the
  // intended ESLint errors.
  {
    files: [
      'src/Scrapers/Pipeline/Strategy/Scrape/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-balance-in-scrape.canary.ts',
    ],
    ignores: ['src/Scrapers/Pipeline/Strategy/Scrape/Account/BalanceExtractor.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/Registry/WK/BalanceResolveWK*', '**/Mediator/BalanceResolve/**'],
              message:
                '🚫 V5 ISOLATION (T50): SCRAPE must not reference BalanceResolve internals. Balance resolution is owned by the BALANCE-RESOLVE phase.',
            },
            PHASE3_COMMON_IMPORT_BAN_PATTERN,
          ],
        },
      ],
    },
  },

  // 8e. V5 LITERAL-BALANCE BAN — proves Agent 2's removal stuck (T50).
  //
  // `ScrapeDataActions.ts` previously held a `'balance'` literal as
  // part of the assembled account shape. v4 moved balance to
  // `ctx.balanceResolution`; this rule blocks the literal from
  // sneaking back in. The canary that proves it fires is armed in §22a.
  {
    files: ['src/Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, NO_BALANCE_LITERAL_RULE],
    },
  },

  // 8f. V6 ISOLATION — BALANCE-FETCH TEMPLATE/PLANNER OWNED BY BALANCE-RESOLVE (H3).
  //
  // The v6 contract emits {@link IBalanceFetchTemplate} from SCRAPE.post
  // but the live planner + fetch loop is owned by BALANCE-RESOLVE alone.
  // Other phases must not import the planner module — they would be
  // duplicating balance work and breaking the single-phase-ownership
  // rule (general-phases-view-guidlines.md). The TYPE itself is shared
  // via PipelineContext.ts (a typed seam, not a behaviour seam).
  //
  // This block targets the dedicated canary so verify.sh proves the
  // rule fires; the canary's import of `BalanceFetchPlanner` is rejected.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/balance-fetch-only-in-balance-resolve.canary.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/Mediator/BalanceResolve/BalanceFetchPlanner*'],
              message:
                '🚫 V6 ISOLATION (H3): BalanceFetchPlanner is consumed only by BalanceResolveActions. Other phases must not depend on it.',
            },
          ],
        },
      ],
    },
  },

  // 8g+8h. BALANCE-RESOLVE MEDIATOR LOCKS (PR #264 CR findings #4 + #7)
  //
  // Both rules scope to the same file, so they MUST share one block: flat
  // config replaces `no-restricted-syntax` options rather than merging them,
  // and two blocks would leave only the later rule armed.
  //
  //   • Quarantine — every `await api.fetchPost/fetchGet` inside the
  //     BALANCE-RESOLVE mediator must be wrapped in a TryStatement
  //     (`safeIssueOneFetch`) so a throw from one bank account's network call
  //     cannot reject the surrounding `Promise.all` and abort every sibling.
  //   • BULK_KEY — the `'__BULK__'` sentinel lives only in
  //     `BalanceFetchPlanner.ts`; consumers import the named constant so the
  //     value can be renamed atomically.
  //
  // The canaries that prove both fire are armed in §22a.
  {
    files: ['src/Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PIPELINE_SYNTAX_RULES,
        BALANCE_QUARANTINE_RULE,
        BALANCE_BULK_LITERAL_RULE,
      ],
    },
  },

  // 8i. BALANCE DEFAULT-ZERO PROHIBITION (PR #264 CR finding #5)
  //
  // `<x>.balance ?? 0` (or `?? null`) makes "balance unknown" identical
  // to a real zero, so PipelineResult cannot fall back to a legacy
  // SCRAPE value. Per coding-principle-guidlines §4 DEFAULT-DENY: skip
  // the slot, do not silently default.
  //
  // Scope = api-direct phase that emits balanceResolution; canary in §22a.
  {
    files: ['src/Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, ...BALANCE_DEFAULT_DENY_RULES],
    },
  },

  // 8a. CROSS-BANK PHASE FACTORIES — STRICT QUALITY RULES
  //
  // Scoped to Phase H deep-factory work. Locks in the project's
  // strictest discipline so PR #232 cannot regress to the prior state:
  //
  //   - **max-lines-per-function: 10** (CLAUDE.md + coding-principle-
  //     guidlines.md "Max 10 lines per method"). Forces extraction.
  //
  //   - **max-statements: 10** (A3). Semantic counterpart to lines;
  //     prevents long methods that pass the line count by stuffing
  //     statements onto one line.
  //
  //   - **sonarjs/no-identical-functions** (A8). Catches the kind of
  //     placeholderConfig + run*Pre/Action/Post/Final unwrap-or-throw
  //     duplication CodeRabbit flagged in rabbit cycle #3 (findings
  //     #1, #2, #7, #8).
  //
  //   - **sonarjs/no-duplicate-string** (A8). Threshold:5 catches
  //     repeated literal magic strings (e.g. `'last-good'` paths,
  //     error-prefix strings) that should be constants.
  //
  //   - **no-restricted-syntax — double-cast ban** (A2). Bans
  //     `expr as unknown as T` outright. CodeRabbit's repeated
  //     finding ("type-system bypass via double-cast") is now a
  //     compile-time error inside the deep-factory zone.
  //
  // Pre-existing files outside this scope can adopt the same limits
  // incrementally in follow-up PRs.
  {
    files: ['src/Tests/Unit/Pipeline/CrossValidation/Phases/**/*.ts'],
    plugins: {
      sonarjs,
    },
    rules: {
      'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 10],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': ['error', { threshold: 5 }],
      'no-restricted-syntax': [
        'error',
        // RABBIT-CYCLE-#4 FINDING #1: ESLint flat-config rule arrays REPLACE
        // (not extend) earlier definitions for files matching the same scope.
        // Spreading RESTRICTED_SYNTAX_RULES first preserves the global guards
        // (coverage-bypass, forbidden-method, PII-leak, security-logging,
        // anti-sleep, ...) that section 4 applies repo-wide; otherwise this
        // §8a block would silently strip them for Phases/** files.
        ...RESTRICTED_SYNTAX_RULES,
        {
          // A2 — ban `expr as unknown as T` double-casts.
          // Phase H rabbit cycle #3 finding #1, #3, #7.
          selector: 'TSAsExpression > TSAsExpression',
          message:
            "🚫 TYPE BYPASS (Phase H rule): 'expr as unknown as T' double-casts are banned in deep-factory tests. Extract a properly typed factory/constant from `Fixtures/_deepPhaseHelpers.ts` instead.",
        },
      ],
    },
  },
  // 9. INDEX FILES EXCEPTION
  {
    files: ['**/index.ts'],
    rules: {
      'check-file/filename-naming-convention': 'off',
    },
  },

  // 10. E2EREAL HAPPY-PATH startDate ENFORCEMENT
  // Every live test must use the shared `defaultStartDate()` helper —
  // never raw `new Date()` (silent 0-day window → false-positive passes
  // that scrape nothing) and never an unbound Identifier or string literal.
  // Selectors target `Property[value.type=...]` so they match only the
  // value side of `startDate: ...`, not the key (which is also Identifier).
  {
    files: ['src/Tests/E2eReal/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        {
          selector: "Property[key.name='startDate'][value.type='NewExpression']",
          message:
            '🚫 ARCHITECTURE: startDate must be `defaultStartDate()` — raw `new Date()` is banned (silent 0-day window).',
        },
        {
          selector: "Property[key.name='startDate'][value.type='Identifier']",
          message:
            '🚫 ARCHITECTURE: startDate must be `defaultStartDate()` — unbound variables are banned (no implicit defaults).',
        },
        {
          selector: "Property[key.name='startDate'][value.type='Literal']",
          message:
            '🚫 ARCHITECTURE: startDate must be `defaultStartDate()` — literal values are banned (use the helper).',
        },
      ],
    },
  },

  // 11. SONARJS + UNICORN PARITY — local equivalents of the 19 SonarCloud
  //     rules that surfaced 661 issues during the v2 cleanup. Catching
  //     them here prevents recurrence at edit time, before commit.
  //
  //     Scope mirrors `sonar-project.properties` `sonar.exclusions`:
  //     active Pipeline production code only. Tests and legacy scrapers
  //     are out of Sonar's scope, so they're out of these rules' scope
  //     too — keeps ESLint and SonarCloud aligned without surfacing
  //     thousands of test-stub issues that don't exist in Sonar.
  //
  //     The list lives in `eslint.canary-scope.mjs` so the parity
  //     canaries in `LintValidator.ts` police exactly this set. See
  //     that file for why it is shared rather than duplicated.
  {
    files: ['src/**/*.ts'],
    ignores: [...SONAR_PARITY_IGNORE_GLOBS],
    rules: {
      // SonarJS — Sonar's own rules
      'sonarjs/no-alphabetical-sort': 'error', // S2871
      'sonarjs/redundant-type-aliases': 'error', // S6564
      'sonarjs/void-use': 'error', // S3735
      'sonarjs/no-invariant-returns': 'error', // S3516 BLOCKER
      'sonarjs/no-identical-functions': 'error', // S4144
      'sonarjs/no-misleading-array-reverse': 'error', // S4043
      'sonarjs/use-type-alias': 'error', // S4323
      'sonarjs/no-skipped-tests': 'error', // S1607
      // Unicorn — modern-JS rules SonarCloud wraps
      // NOTE: `unicorn/prefer-export-from` (S7763) is NOT declared here.
      // It is enforced repo-wide and strict by §12e below, which is a
      // superset of this block's scope. Declaring it twice would let the
      // two copies drift apart — the exact failure that caused PR #500.
      'unicorn/prefer-string-replace-all': 'error', // S7781
      'unicorn/prefer-string-raw': 'error', // S7780
      'unicorn/prefer-at': 'error', // S7755
      'unicorn/no-useless-promise-resolve-reject': 'error', // S7746
      'unicorn/catch-error-name': 'error', // S7718
      'unicorn/prefer-global-this': 'error', // S7764
      'unicorn/prefer-includes': 'error', // S7765
      'unicorn/prefer-array-find': 'error', // S7750
      'unicorn/prefer-array-index-of': 'error', // S7753
      'unicorn/prefer-single-call': 'error', // S7778
      // Built-in
      'prefer-object-spread': 'error', // S6661
    },
  },

  // 12c. QUALITY RULES (Security Hardening 2026-05) — `readonly`
  //      private fields, `node:` protocol prefix for built-in imports.
  //      Both rules close Sonar findings (S2933 + S7772) AND prevent
  //      the same patterns from being reintroduced by future PRs.
  {
    files: ['src/**/*.ts'],
    rules: {
      // S2933 — fields that are never reassigned must be `readonly`.
      // Decision: enable globally because zero collateral hits were
      // observed in the Observe dry-run; the rule guards immutability
      // across every class in the codebase.
      '@typescript-eslint/prefer-readonly': 'error',
      // S7772 — Node built-in imports must use the `node:` prefix so
      // the built-in is distinguished from any third-party npm
      // package that could shadow it (the `events` package exists
      // separately on npm). Decision (Decide §4 RC-9): enable globally
      // at `error`; the 11 collateral hits surfaced by Observe are
      // fixed inline in the same commit so the rule lands with zero
      // outstanding violations.
      'unicorn/prefer-node-protocol': 'error',
    },
  },

  // 12d. JEST ASSERTION RULES (Security Hardening 2026-05) — scoped
  //      to unit tests under `src/Tests/Unit/**` per Decide §4 Q4
  //      (the collateral budget for `jest/expect-expect` on
  //      `src/Tests/E2e*` is 61 hits — out of scope; E2E flow tests
  //      use a throw-based assertion idiom in shared helpers and are
  //      excluded by this override).
  {
    files: ['src/Tests/Unit/**/*.test.ts'],
    plugins: { jest },
    rules: {
      // `assertFunctionNames` teaches `jest/expect-expect` about the
      // project's shape-helper conventions. CrossValidation phase
      // tests already validate `expect(...)` inside helpers named
      // either `assert<Phase>Shape(finalCtx)` (six factories) or
      // `run<Phase>ForRow(row)` (FullFlow + InitPhase factories);
      // the rule's default name list (just `expect`) misses both
      // and forces redundant inline assertions. Per CodeRabbit
      // feedback on PR #248, recognising the `assert*` and `run*`
      // names lets each helper be the single source of truth and
      // removes the duplicate-assertion noise.
      'jest/expect-expect': ['error', { assertFunctionNames: ['expect', 'assert*', 'run*'] }],
      'jest/no-standalone-expect': 'error',

      // `@typescript-eslint/unbound-method` cannot see that `expect(obj.method)`
      // never calls the reference — it only inspects it — so it reports every
      // `expect(page.waitForURL).toHaveBeenCalled()` assertion as an unsafe
      // unbound reference. `jest/unbound-method` is the Jest-aware extension of
      // the SAME rule, published by typescript-eslint/eslint-plugin-jest for
      // exactly this pairing: it keeps the check everywhere else in the file and
      // only exempts the `expect()` argument position. This is a swap, not a
      // relaxation — the base rule stays 'error' for all non-test code.
      // See https://typescript-eslint.io/rules/unbound-method/#how-to-use (Jest note).
      '@typescript-eslint/unbound-method': 'off',
      'jest/unbound-method': 'error',
    },
  },

  // 12e. RE-EXPORT SHORTHAND (`unicorn/prefer-export-from`, Sonar
  //      `typescript:S7763`) — REPO-WIDE AND STRICT.
  //
  //      This is the SINGLE declaration of the rule. §11 deliberately
  //      omits it and points here.
  //
  //      History — why the scope is now global:
  //      • 2026-05 (Security Hardening) introduced this block scoped to
  //        `src/Scrapers/Base/**` only, keeping the global default loose
  //        so the collateral hits elsewhere stayed out of that PR.
  //      • PR #274 extended the scope to `src/Scrapers/Pipeline/Types/**`
  //        after 11 more instances surfaced there, and recorded that the
  //        Sonar failure "cannot recur".
  //      • It recurred. PR #500 hit 32 S7763 issues under
  //        `src/Scrapers/Pipeline/Banks/**` — a folder no one had
  //        enumerated. Enumerating folders one incident at a time only
  //        ever covers the folders that already failed.
  //
  //      The whole `src` tree was converted to `export ... from` in the
  //      commits preceding this one, so the strict rule starts from a
  //      verified zero-violation baseline and no grandfather override is
  //      needed. `files: ['src/**/*.ts']` intentionally also covers the
  //      Sonar-excluded paths (`src/Tests/**`, `src/Common/**`, legacy
  //      scrapers, `src/Scrapers/Registry/**`): keeping them clean costs
  //      nothing now and removes the next enumeration gap.
  //
  //      Canary: `re-export-shorthand.canary.ts`. `EslintCanaries/**` is
  //      globally ignored (§1), but `verify.sh` lints with `--no-ignore`,
  //      so `files:` matching still governs — `src/**/*.ts` covers it and
  //      the previous single-file entry is no longer required. The canary
  //      exports a locally-used imported binding, so it only fires while
  //      `checkUsedVariables` is `true`; if that flag is ever loosened the
  //      canary goes silent and `verify.sh` fails it as dead.
  //
  //      2026-06-08 compat: eslint-plugin-unicorn v65 renamed the legacy
  //      `ignoreUsedVariables: boolean` option to `checkUsedVariables`
  //      with inverted semantics. Mapping: `ignoreUsedVariables: true`
  //      ↔ `checkUsedVariables: false` (loose); `ignoreUsedVariables:
  //      false` ↔ `checkUsedVariables: true` (strict). v65 rejects the
  //      legacy key outright ("should NOT have additional properties").
  {
    files: ['src/**/*.ts'],
    plugins: { unicorn },
    rules: {
      'unicorn/prefer-export-from': ['error', { checkUsedVariables: true }],
    },
  },

  // 12f. PII REDACTOR CLUSTER — PER-FUNCTION ≤10-LoC CAP
  //
  // Phase 8.5c / Commit C2 — lock in the §13A `PiiRedactor/Facade.ts`
  // grandfather drain (split into Routing + Dispatch + Composer in
  // C1) by enforcing the global ≤10-LoC function cap across the whole
  // PiiRedactor cluster. The split modules already comply; this rule
  // prevents any future contributor from re-introducing the long
  // helper functions that §13A was created to tolerate.
  //
  // Broader `Pipeline/Types/**` + `Scrapers/Base/**` per-function-cap
  // rollout is deferred to a follow-up phase — those folders contain
  // 60+ pre-existing long functions (BasePhase, FixtureCapture,
  // Debug, RunLabel, …) that legitimately need surgical extraction
  // work beyond Phase 8.5c's scope (see status.txt deferral entry).
  {
    files: ['src/Scrapers/Pipeline/Types/PiiRedactor/**/*.ts'],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 12b. TEST STUB EXCEPTION — `require-await` flags `async` methods
  //      that don't actually await. Production code MUST await; test
  //      stubs (e.g., `async fetchData() { return ScraperResult.ok }`)
  //      mock the Promise<T> return type without doing real async work.
  //      Disabled only inside `src/Tests/Unit/Base*` legacy stubs.
  {
    files: [
      'src/Tests/Unit/BaseScraper.test.ts',
      'src/Tests/Unit/BaseScraperWithBrowser.test.ts',
      'src/Tests/Unit/BaseScraperWithBrowserExtended.test.ts',
    ],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },

  // 13. Legacy bank lookup safety canary — scoped to shared base code only.
  //
  //     The PR #205 root cause was `BaseScraperWithBrowser.login()` doing
  //     a bare destructure of SCRAPER_CONFIGURATION.banks[runtimeId] —
  //     pipeline-only banks aren't in that map, so the lookup returned
  //     undefined and the destructure crashed the scrape. The fix is the
  //     `resolveLegacyBank(companyId)` helper which returns a discriminated
  //     Result. This canary forbids reintroducing the bare lookup in any
  //     other shared-base file. Per-bank scrapers (src/Scrapers/<Bank>/)
  //     can still access their own config row directly because their
  //     companyId IS guaranteed to be in the map.
  //
  //     The helper FILE itself (BaseScraperWithBrowser.ts) is allowed via
  //     a `files` glob that excludes it.
  {
    files: ['src/Scrapers/Base/**/*.ts'],
    ignores: ['src/Scrapers/Base/BaseScraperWithBrowser.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        NO_DIRECT_SCREENSHOT_RULE,
        {
          selector:
            "MemberExpression[computed=true][object.type='MemberExpression'][object.object.name='SCRAPER_CONFIGURATION'][object.property.name='banks']",
          message:
            "🚫 LEGACY BANK LOOKUP: Use resolveLegacyBank(companyId) instead of bare SCRAPER_CONFIGURATION.banks[...]. Pipeline-only banks aren't in this map; direct access can crash with 'cannot destructure undefined'.",
        },
      ],
    },
  },

  // 14. NO DIRECT page.screenshot() — added 2026-05-21 after PR #248 CI
  //     artifact 7128234088 leaked 18+ post-auth PNGs (run 26207506594).
  //     The SafeScreenshot helper is the only sanctioned call site —
  //     it short-circuits in CI to keep rendered bank pixels out of
  //     public-readable artifacts. The canonical implementation lives
  //     at `src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts`
  //     and is allow-listed so the helper itself can call
  //     `page.screenshot()` without tripping the rule.
  //     Pipeline and Scrapers/Base are excluded here and carry the ban
  //     through their own blocks instead. Both declare extra selectors of
  //     their own, and flat config REPLACES `no-restricted-syntax` options
  //     rather than merging them — so while this block matched them last it
  //     silently overwrote everything they declared. See
  //     `check-syntax-guardrails` for the gate that now proves it cannot
  //     happen again.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/Scrapers/Pipeline/**', 'src/Scrapers/Base/**', 'src/Tests/**'],
    rules: {
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES, NO_DIRECT_SCREENSHOT_RULE],
    },
  },

  // 14a. Contract exemptions are applied in one place at the end of this
  //     config, generated from PIPELINE_SELECTOR_EXEMPTIONS, so they cannot
  //     themselves be overwritten by a later block.

  // 15. NO SUPPRESSION COMMENTS — Phase 2 of Security Hardening 2026-05.
  //     Bans every suppression-comment family on src/** so future
  //     contributors cannot silence a Sonar / TypeScript / Biome /
  //     ESLint / coverage rule instead of fixing the underlying
  //     issue. Routed through ESLint's built-in `no-warning-comments`
  //     rule (terms-array form) because Line/Block AST selectors
  //     (`Line:matches([value*='...'])`) are non-functional in
  //     ESLint 9 + typescript-eslint flat-config — verified
  //     empirically. The terms-array form fires on both Line and
  //     Block comments. Canary fixtures in EslintCanaries/ are
  //     intentionally malformed; excluded via `ignores`, then re-armed
  //     for the two canaries that certify this rule (§15a) — a blanket
  //     ignore is what left `no-suppression-comments.canary.ts` unable to
  //     fire the rule it exists to prove.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/Scrapers/Pipeline/EslintCanaries/**'],
    rules: {
      'no-warning-comments': ['error', SUPPRESSION_COMMENT_OPTIONS],
    },
  },

  // 15a. SUPPRESSION-COMMENT CANARIES — re-arm §15 on the fixtures that
  //      certify it. §15 ignores the whole canary directory because most
  //      canaries carry deliberately-malformed markers; that blanket
  //      exclusion also covered the canary whose entire job is to prove
  //      §15 still fires, so it passed on incidental lint noise instead.
  //      Listed explicitly, not by glob, so adding a canary cannot
  //      silently opt it into a rule it was not written for.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/no-suppression-comments.canary.ts'],
    rules: {
      'no-warning-comments': ['error', SUPPRESSION_COMMENT_OPTIONS],
    },
  },

  // 15b. JEST ASSERTION CANARY — `jest/expect-expect` is scoped to
  //      `src/Tests/Unit/**/*.test.ts`, which the canary directory is not
  //      part of. The canary's own docblock claimed the harness passed
  //      `--rule 'jest/expect-expect: error'`; it never did, so the file
  //      certified nothing. Arming the rule here is the honest spelling.
  //
  //      `globals` matters: eslint-plugin-jest resolves `it` / `test` through
  //      scope and ignores a locally-declared stub, so the canary's original
  //      `declare function it(...)` was itself enough to keep the rule silent.
  //      Declaring the jest globals here is what makes the call recognisable.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/jest-expect-expect.canary.ts'],
    plugins: { jest },
    languageOptions: {
      globals: { it: 'readonly', test: 'readonly', describe: 'readonly', expect: 'readonly' },
    },
    rules: {
      'jest/expect-expect': ['error', { assertFunctionNames: ['expect', 'assert*', 'run*'] }],
    },
  },

  // 11. NETWORK SUB-MODULE FILE-SIZE + FUNCTION-SIZE GUARD
  //
  // Phase 4 split the 1812-LoC NetworkDiscovery.ts blob into seven
  // focused sub-modules under `Mediator/Network/`. Section 7 turns
  // `max-lines` off across all `Mediator/**` files (DI factories,
  // Strategy adapters, and similar infrastructure files are
  // legitimately long); without a re-imposed bound on the Network
  // sub-folder, future commits could quietly re-blob one of the new
  // homes back toward four-digit line counts.
  //
  // PR #276 review-fix: CodeRabbit pushed back on the 500-line cap
  // — at that ceiling, files this size routinely violate SRP
  // (Scoring.ts at 335 LoC already mixed shape-tier ranking,
  // header probing and SPA-discovery). We tighten the ceiling to
  // **150 effective lines per file** and add a **10-line cap per
  // function** (skipBlankLines + skipComments) so every Network/
  // sub-module stays small enough for a single reviewer to hold
  // in working memory.
  //
  // Phase 8.5a (commits 1-6): the three grandfathered legacy files
  // (`Fetch.ts`, `AuthFailureWatcher.ts`, `AuthDiscovery.ts`) are
  // now fully drained into focused sub-modules, and every remaining
  // function across `Mediator/Network/**` fits the 10-LoC cap.
  // Section §11A grandfather override is therefore removed and the
  // per-function cap is tightened from 20 → 10 to match the §13
  // PiiRedactor and CLAUDE.md ideal.
  //
  // The shim itself (`NetworkDiscovery.ts`) is intentionally left
  // unconstrained — Section 7 already allows it, and this guard is
  // about preventing regression of the new homes, not the facade.
  //
  // Two canary files enforce both halves of the cap: the
  // `no-network-discovery-blob.canary.ts` over-sizes the file to
  // prove `max-lines` fires, and the
  // `network-cluster-fn-over-cap.canary.ts` over-sizes a single
  // function to prove `max-lines-per-function` fires.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Network/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-network-discovery-blob.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/network-cluster-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 12. SCRAPE SUB-MODULE FILE-SIZE + FUNCTION-SIZE GUARD (baseline)
  //
  // Phase 5 split the 1637-LoC ScrapeAutoMapper.ts blob into eleven
  // focused sub-modules under `Mediator/Scrape/<Bucket>/` (mirror of
  // Phase 4's Network/ split). Section 7 turns `max-lines` off
  // across all `Mediator/**` files; without a re-imposed bound on
  // the Scrape sub-folder, future commits could quietly re-blob one
  // of the new homes back toward four-digit line counts.
  //
  // Per-function cap: the Phase 5 baseline for this glob **was** 20
  // effective lines, chosen so pre-existing files unrelated to Phase
  // 8.5b's canonical-10 drain (AccountExtractor, BfsFieldSearch,
  // Coercion, ContainerPicker, EndpointResolver, ForensicAuditAction,
  // JsonTraversal, MirrorDetection, ScrapeUiTrigger, TxnMapper,
  // TxnShape, LifoCrawl, TxnHunt) were not forced into a
  // phase-mismatched refactor. That 20 is now dead: §12B below raises
  // the bar to 10 for the drained canonical-10 sub-folders
  // (ScrapePhase/**, ScrapeReplay/**, FrozenScrapeAction,
  // UrlDateRange), §14b.4 re-scopes ALL of `Mediator/Scrape/**` to 10
  // for the Phase 2e drain, and the §19.0 strict baseline — later
  // still, and therefore the block that actually wins — resolves every
  // one of the 65 production files under this glob to 10. Flat config
  // is last-wins, so no production file here resolves to 20 any more.
  // The `max-lines-per-function` rule is therefore NOT declared in this
  // block: a dead 20 would read as the effective cap and mislead the
  // next maintainer, which is precisely the failure the cap-regime gate
  // in `src/Tests/Tools/` exists to surface.
  //
  // File-size cap stays at **150 effective lines** so every Scrape
  // sub-module still fits in a single reviewer's working memory. The
  // shim (`ScrapeAutoMapper.ts`) sits under this same glob and so is
  // bound by that 150 too — Section 7 turns `max-lines` off across
  // `Mediator/**`, and this block is what puts it back for Scrape.
  //
  // One canary enforces the file half of the cap: the
  // `no-scrape-mapper-blob.canary.ts` over-sizes the file to prove
  // `max-lines` fires. The function half is proved by
  // `scrape-cluster-fn-over-cap.canary.ts`, which is un-ignored in
  // §19.0 so it resolves through the same block production does. It
  // deliberately does NOT live here: this block declares no
  // per-function cap, so there is nothing here for it to certify.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-scrape-mapper-blob.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 12B. SCRAPE CANONICAL-10 SUB-FOLDER PER-FN CAP (Phase 8.5b 2026-05-31)
  //
  // Locks the canonical-10 per-function cap (max 10 eff LoC) for the
  // four sub-trees drained during Phase 8.5b commits C1-C5:
  //   • `ScrapePhase/**` — composer + leaf modules split from
  //     ScrapePhaseActions.ts (C4 + C5)
  //   • `ScrapeReplay/**` — sub-modules split from
  //     ScrapeReplayAction.ts (C3)
  //   • `FrozenScrapeAction.ts` — in-place drained (C2)
  //   • `UrlDateRange.ts` — in-place drained (C1)
  //
  // This is a **scoped** tightening (not a global §12 drop) because
  // the broader Mediator/Scrape/** surface contains files unrelated
  // to Phase 8.5b's canonical-10 work; forcing those into the same
  // tightened cap here would expand C6 scope into a phase-mismatched
  // drain. Those pre-existing files keep §12's cap-20 baseline and
  // are slated for their own dedicated drain phase.
  //
  // The §12A grandfather block (which previously exempted the four
  // drained files at cap 20) was deleted in the same commit — all
  // four files now meet cap 10 through the C1-C4 refactor work.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhase/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/FrozenScrapeAction.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/UrlDateRange.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-canonical10-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 12C. SCRAPE CANONICAL-10 LOOKUP-ARRAY NAMING GUARD (PR #281 C8 hardening, 2026-05-31)
  //
  // Pattern detection: PR #281 SonarCloud flagged the same anti-pattern
  // (`typescript:S7776`) in TWO files within the canonical-10 sub-folders:
  //   • `ScrapeReplay/JsonReplace.ts:47` — `lowerKeys = keys.map(toLowerCase)` then `.includes`
  //   • `ScrapeReplay/RecordShape.ts:158` — `lowerKeys = bodyKeys.map(toLowerCase)` then `.includes`
  //
  // Root cause: a variable named `lowerKeys` (or `lowerXxxKeys`) conveys
  // "set of keys for membership testing" — semantically a Set, not an Array.
  // eslint-plugin-sonarjs@4.0.3 does NOT expose S7776 and a pure AST data-flow
  // rule is fragile, so we enforce a NAMING convention in canonical-10
  // sub-folders: `lower*Keys` is forbidden — force authors to either
  // `lowerKeySet = new Set(...)` (lookup) or `lowerNames` (iteration-only).
  //
  // The accompanying canary
  // `scrape-canonical10-lookup-array-shouldbe-set.canary.ts` exhibits
  // the banned name; it is armed in §22a.
  //
  // Generated from PIPELINE_SCOPED_SYNTAX_EXTRAS so that §23's exemption
  // blocks — which are emitted later and rebuild the rule wholesale — can
  // re-add these selectors from the same source instead of dropping them.
  ...PIPELINE_SCOPED_SYNTAX_EXTRAS.map(scope => ({
    files: scope.files,
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, ...scope.rules],
    },
  })),

  // 12D. SCRAPE CANONICAL-10 NO-NEGATED-CONDITION GUARD (PR #281 C9 hardening, 2026-05-31)
  //
  // Pattern detection: PR #281 SonarCloud flagged `typescript:S7735`
  // ("Unexpected negated condition") TWICE in the canonical-10 sub-folders:
  //   • PR #281 SQ-1 — `ScrapePhase/PhaseActions.ts` `executeStampAccounts`
  //     `if (!input.txnEndpoint.has) { … } else { … }` (early-cycle finding)
  //   • PR #281 C9     — `ScrapePhase/PhaseActions.ts:139` ternary
  //     `template.url !== '' ? template : undefined` (post-C8 finding)
  //
  // Both expose a tiny readability cost (cognitive double-negation),
  // both surface in the same drained sub-folder, and both are trivially
  // fixable by swapping branches to positive-first. Built-in ESLint
  // `no-negated-condition` is the canonical mirror of S7735 — enable it
  // locally so authors catch this BEFORE pushing.
  //
  // The accompanying canary
  // `scrape-canonical10-negated-condition.canary.ts` exhibits the banned
  // pattern (both if-else and ternary forms) so verify.sh asserts the
  // rule fires on every commit.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhase/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/FrozenScrapeAction.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/UrlDateRange.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-canonical10-negated-condition.canary.ts',
    ],
    rules: {
      'no-negated-condition': 'error',
    },
  },

  // 13. PII REDACTOR SUB-MODULE FILE-SIZE + PER-FN + ANTI-LITERAL GUARD
  //
  // Phase 6 split the 996-LoC PiiRedactor.ts blob into thirteen
  // focused sub-modules under `Types/PiiRedactor/` (mirror of
  // Phase 4 Network/ and Phase 5 Scrape/ splits). Section 7 turns
  // `max-lines` off across all `Types/**` files; without a
  // re-imposed bound on the PiiRedactor sub-folder, future commits
  // could quietly re-blob one of the new homes back toward
  // four-digit line counts.
  //
  // Caps (all derived from CLAUDE.md "Code Quality" + the
  // §11/§12 precedent for sibling Phase-4 / Phase-5 clusters):
  //   • `max-lines` = **150** effective LoC (matches §11/§12)
  //   • `max-lines-per-function` = **10** effective LoC (matches
  //     CLAUDE.md "Max 10 lines per method"; CR cycle-1 #7 escaped
  //     under the §6C default cap of 15)
  //   • `no-restricted-syntax` bans hardcoded `'[REDACTED]'` /
  //     `'[OTP]'` / `'[REDACTION_ERROR]'` literals so per-category
  //     modules must import the matching constant from Types.ts
  //     (CR cycle-1 #9 — "Use constants from configuration, never
  //     hardcode values inline").
  //   • `sonarjs/no-identical-functions` catches duplicate fn
  //     bodies (e.g. the FALLBACK_PATTERNS regex helper that CR
  //     cycle-1 #4/#5 caught duplicated across JsonBody.ts and
  //     Html.ts).
  //   • `sonarjs/no-duplicate-string` threshold:3 surfaces
  //     repeated string literals before they become hardcoded
  //     constants.
  //
  // The shim itself (`PiiRedactor.ts`) is intentionally left
  // unconstrained — Section 7 already allows it, and this guard
  // is about preventing regression of the new homes, not the
  // tombstone re-export.
  //
  // Pre-existing files that already exceed the new file-size cap
  // (`Facade.ts` ~162 eff LoC — composes every per-category
  // strategy + the path-tail routing table + the dispatcher) are
  // grandfathered via §13A below, mirroring the §11A / §12A
  // pattern. The sentinel definers (`Types.ts`, which OWNS the
  // hint constants) are unlocked via §13B so the bans don't fire
  // on the defining file.
  //
  // Canaries:
  //   • `no-pii-redactor-blob.canary.ts` — proves `max-lines`
  //     fires (file > 150 LoC)
  //   • `pii-cluster-fn-over-cap.canary.ts` — proves
  //     `max-lines-per-function: 10` fires (function > 10 LoC)
  //   • `pii-hardcoded-sentinel.canary.ts` — proves the
  //     sentinel-literal ban fires (armed in §22a, not here)
  {
    files: [
      'src/Scrapers/Pipeline/Types/PiiRedactor/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-pii-redactor-blob.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/pii-cluster-fn-over-cap.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/pii-facade-no-grandfather.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/lint-guideline-coverage-defaults-audit.canary.ts',
    ],
    plugins: { sonarjs },
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      // The sentinel canary is armed in §22a — a canary-directory block
      // declared later would replace these options and disarm it.
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, ...PII_SENTINEL_LITERAL_RULES],
    },
  },

  // 13B. PII CONSTANT DEFINER UNLOCK
  //
  // `Types.ts` legitimately HOLDS the hint constants — its
  // `export const REDACTED_HINT = '[REDACTED]'` declaration MUST
  // contain the bare literal. Unlock the §13 sentinel ban here.
  //
  // Re-declaring the shared contract, NOT `'no-restricted-syntax': 'off'`.
  // `off` lifted all sixty-one selectors to excuse four sentinel literals,
  // leaving the module that defines the redaction vocabulary as the only
  // production Pipeline file with no restricted-syntax guardrails at all.
  // The §13 sentinel selectors are additions on top of the contract, so
  // simply not repeating them here grants exactly the intended unlock.
  {
    files: ['src/Scrapers/Pipeline/Types/PiiRedactor/Types.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES],
    },
  },

  // 13C. PII ERROR-LOG NO-BYPASS LOCK
  //
  // `ErrorLog.ts` MUST NEVER reference `isPiiRedactionDisabled` —
  // bank error messages are security-classified (CodeQL #28 / CR
  // cycle-1 #3): they always redact, even with `PII_REDACTION=off`.
  //
  // The canary that proves the rule fires is armed in §22a instead of
  // being listed here: a canary-directory block declared later would
  // replace these options and silently disarm it.
  {
    files: ['src/Scrapers/Pipeline/Types/PiiRedactor/ErrorLog.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, PII_ERRORLOG_NO_BYPASS_RULE],
    },
  },

  // 14. API-DIRECT-CALL CONFIGCONTRACTS FILE-SIZE + PER-FN GUARD
  //
  // Phase 8 split the 369-LoC `IApiDirectCallConfig.ts` god-type-tree
  // into six concern-slice sub-modules under
  // `Mediator/ApiDirectCall/ConfigContracts/` (mirror of Phase 4
  // Network/, Phase 5 Scrape/, Phase 6 PiiRedactor/ splits).
  // Section 7 turns `max-lines` off across all `Mediator/**` files;
  // without a re-imposed bound on the ConfigContracts sub-folder,
  // future commits could quietly re-blob one of the new homes back
  // toward four-digit line counts.
  //
  // Caps (canonical CLEAN_CODE.md "Code Quality" — matches §13
  // PiiRedactor; type-only files should stay even smaller than
  // logic-bearing clusters §11/§12, so per-fn cap is the strict 10):
  //   • `max-lines` = **150** effective LoC (matches §11/§12/§13)
  //   • `max-lines-per-function` = **10** effective LoC (matches
  //     CLAUDE.md "Max 10 lines per method" + §13 precedent)
  //   • `complexity` = **10** + `@typescript-eslint/max-params` = **3**
  //     are inherited from §5/§6 globals — the guideline-coverage
  //     gate (`npm run lint:guideline-coverage`) asserts the
  //     resolved values stay ≤ canonical.
  //   • `sonarjs/no-identical-functions` catches duplicate
  //     factory / helper bodies if any are added later.
  //   • `sonarjs/no-duplicate-string` threshold:3 surfaces repeated
  //     string literals (signer-algorithm tags, ref-token prefixes)
  //     before they harden into hardcoded constants.
  //
  // The legacy `IApiDirectCallConfig.ts` shim this guard was written
  // alongside was deleted in Phase 3 (v8.6). The guard remains valid on
  // its own terms: it is about preventing regression of the new homes,
  // and never depended on the tombstone re-export existing.
  //
  // Canary:
  //   • `no-api-direct-call-blob.canary.ts` — proves `max-lines`
  //     fires (file > 150 LoC) so the guard cannot silently rot.
  //
  // CR feedback (PR #279, finding F1): canary now uses 71 *unique*
  // function bodies (each returns its own integer literal) so the
  // co-enabled `sonarjs/no-identical-functions` (S4144) cannot
  // silently fire on duplicate bodies and mask a future
  // `max-lines:150` regression. Note that rule-firing identity
  // (asserting the *specific* error ID, not just `errorCount > 0`)
  // is tracked separately as Phase 8.5c canary-infrastructure
  // hardening — that work also adds the `tsconfig.eslint.json`
  // needed to surface the intended rule instead of a fallback parse
  // error caused by the canary dir being excluded from the main
  // tsconfig.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-api-direct-call-blob.canary.ts',
    ],
    plugins: { sonarjs },
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
    },
  },

  // 14. INIT SUB-MODULE FUNCTION-SIZE GUARD (strict 10-LoC)
  //
  // PR #288 added the L4 transport-forensics envelope under
  // `Mediator/Init/**` (InitActions.ts, NavigationDiagnostics.ts,
  // NavigationRequestLifecycle.ts, NavigationTransportProbe.ts).
  // Those splits inherited the lax 20-cap default and immediately
  // accumulated 24 over-cap function bodies — a regression caught
  // only by CodeRabbit (R3-1..R3-5), not the pre-commit hook.
  //
  // Per `eslint-rules-guidlines.md` §1 (ALWAYS tighten when you
  // split a module) and §2 (every strict cluster needs a canary),
  // this cluster now pins Init/ to the canonical 10-LoC ceiling.
  // No `max-lines` (file-size) cap yet — Init/ files are still
  // large after the split; that hardening lands in a separate
  // commit once the helpers are stable.
  //
  // Canary: `init-cluster-fn-over-cap.canary.ts` over-sizes a
  // single function so verify.sh confirms the rule fires.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Init/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/init-cluster-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 14b. PHASE 2 LOCKDOWN — full strict three-rule lock (`refactor/phase-2-decoupling-mediator`).
  //
  // Phase 2 (loose commits 3533ed97 / ec30d4ad / 01cdcebf / 53809048 +
  // strict commits 59a4b837 / 98572c69 / 3961607b / 4ee2046b / 9c94087d)
  // extracted ~250+ over-cap functions across 55 cluster files in the
  // Mediator/ tree down to ≤10-statement, ≤10-line bodies AND split
  // every cluster file to ≤150-line co-located siblings. The four
  // override blocks below pin all 19 Mediator/ sub-clusters touched
  // in Phase 2 to the canonical three-rule lock (no relaxation):
  //
  //   • max-statements: 10            — body statement count
  //   • max-lines-per-function: 10    — signature+body+brace
  //                                     (skipBlankLines + skipComments + IIFEs)
  //   • max-lines: 150                — per-file
  //                                     (skipBlankLines + skipComments)
  //
  // The three rules lock in lock-step: a function may grow to 10
  // statements OR 10 lines OR live in a 150-line file before its
  // cluster fails CI. Any future "let it slip just one more" attempt
  // is rejected. File-split hardening is no longer deferred.
  //
  // Canaries — one fn-over-cap + one file-over-cap per cluster — live
  // alongside in EslintCanaries/ and are scoped into each block via
  // the `files` array so the corresponding rule provably fires:
  //   • mediator-api-selector-fn-over-cap.canary.ts (max-statements + max-lines-per-function)
  //   • mediator-api-selector-file-over-cap.canary.ts (max-lines)
  //   • mediator-dashboard-fn-over-cap.canary.ts
  //   • mediator-dashboard-file-over-cap.canary.ts
  //   • mediator-auth-fn-over-cap.canary.ts
  //   • mediator-auth-file-over-cap.canary.ts
  //   • mediator-residue-fn-over-cap.canary.ts
  //   • mediator-residue-file-over-cap.canary.ts

  // 14b.1. Phase 2b cluster — Api + ApiDirectCall + Selector.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Api/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/ApiDirectCall/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Selector/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-api-selector-fn-over-cap.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-api-selector-file-over-cap.canary.ts',
    ],
    rules: {
      'max-statements': ['error', 10],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 14b.2. Phase 2c cluster — Dashboard.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Dashboard/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-dashboard-fn-over-cap.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-dashboard-file-over-cap.canary.ts',
    ],
    rules: {
      'max-statements': ['error', 10],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 14b.3. Phase 2d cluster — Login + PreLogin + AuthDiscovery.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Login/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/PreLogin/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/AuthDiscovery/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-auth-fn-over-cap.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-auth-file-over-cap.canary.ts',
    ],
    rules: {
      'max-statements': ['error', 10],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 14b.4. Phase 2e cluster — 11 residue sub-clusters (incl. full Scrape/).
  // Last-wins applies all three caps to the entire Phase 2e drain surface.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/BalanceResolve/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/AccountResolve/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/OtpFill/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/OtpTrigger/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Otp/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Browser/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Home/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Credentials/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Terminate/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Timing/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-residue-fn-over-cap.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-residue-file-over-cap.canary.ts',
    ],
    rules: {
      'max-statements': ['error', 10],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 14c. PHASE 12e — Init TransportProbe file-size lock.
  //
  // PR #288 landed the L4 transport-forensics probe as a single
  // 1036-LoC `Mediator/Init/NavigationTransportProbe.ts` god-module.
  // §14 (above) pinned Init/ to the 10-LoC per-function cap but
  // deferred the file-size (`max-lines`) hardening "once the helpers
  // are stable". Phase 12e drains that file: the probe is now a barrel
  // facade re-exporting focused co-located modules under
  // `Mediator/Init/TransportProbe/` (Types / Reject / Result / Url /
  // Dns / Tcp / Tls / Probe).
  //
  // Per `eslint-rules-guidlines.md` §1 (tighten when you split) this
  // block pins the new sub-cluster + the facade to the canonical
  // three-rule lock shared by every other Pipeline cluster. §4
  // (narrow, never revert): scope is the TransportProbe sub-tree +
  // facade only — the cluster-wide `Mediator/Init/**` file cap lands
  // once the remaining Init files (InitActions, PageObservers,
  // EnvSnapshot, NavigationDiagnostics, NavigationRequestLifecycle)
  // are drained too. 150 is justified: the largest drained sub-module
  // (Tls.ts) measures ~129 effective lines (skipBlankLines +
  // skipComments), comfortably under the shared 150 ceiling.
  //
  // Canary: `init-transport-probe-file-over-cap.canary.ts` over-sizes
  // a file so verify.sh confirms `max-lines` fires.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Init/TransportProbe/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Init/NavigationTransportProbe.ts',
      'src/Scrapers/Pipeline/EslintCanaries/init-transport-probe-file-over-cap.canary.ts',
    ],
    rules: {
      'max-statements': ['error', 10],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 14d. PHASE 12e — Scrape Executor file-size lock.
  //
  // `Strategy/Scrape/ScrapeExecutor.ts` was a 167-LoC generic scrape
  // orchestrator (fetch + per-account iteration + assembly). §19.1
  // (below) pins Strategy/Scrape to per-function caps (40 lines / 20
  // statements) but leaves the file-size (`max-lines`) guard off.
  // Phase 12e drains the file: it is now a barrel facade re-exporting
  // focused co-located modules under `Strategy/Scrape/Executor/`
  // (Types / Fetch / Account / Execute).
  //
  // Per `eslint-rules-guidlines.md` §1 (tighten when you split) this
  // block turns on the missing `max-lines` guard for the new
  // sub-cluster + the facade, pinning them to the canonical 150-line
  // Pipeline ceiling. §4 (narrow, never revert): scope is the Executor
  // sub-tree + facade only — the remaining over-cap Strategy/Scrape
  // files (AccountScrapeStrategy, ScrapeDataActions, MatrixLoopStrategy)
  // get their own file caps as they are drained in subsequent Phase 12e
  // PRs. 150 is justified: the largest drained sub-module (Fetch.ts)
  // measures well under 150 effective lines (skipBlankLines +
  // skipComments), comfortably inside the shared ceiling.
  //
  // Canary: `scrape-executor-file-over-cap.canary.ts` over-sizes a file
  // so verify.sh confirms `max-lines` fires.
  {
    files: [
      'src/Scrapers/Pipeline/Strategy/Scrape/Executor/**/*.ts',
      'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeExecutor.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-executor-file-over-cap.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 14e. PHASE 12e — AccountScrape file-size lock.
  //
  // `Strategy/Scrape/Account/AccountScrapeStrategy.ts` was a 217-LoC
  // per-account scrape strategy (matrix → first-wave → billing → range
  // → direct POST/GET orchestration). §19.1 (below) pins Strategy/Scrape
  // to per-function caps (40 lines / 20 statements) but leaves the
  // file-size (`max-lines`) guard off. Phase 12e drains the file into
  // co-located focused siblings under `Strategy/Scrape/Account/`
  // (AccountScrapeShared / AccountScrapePost / AccountScrapeFirstWave)
  // behind the unchanged orchestrator facade.
  //
  // Per `eslint-rules-guidlines.md` §1 (tighten when you split) this
  // block turns on the missing `max-lines` guard for the Account
  // sub-cluster + every co-located strategy, pinning them to the
  // canonical 150-line Pipeline ceiling. §4 (narrow, never revert):
  // scope is the Account/ sub-tree only — the remaining over-cap
  // Strategy/Scrape files (ScrapeDataActions, MatrixLoopStrategy) get
  // their own file caps as they are drained in subsequent Phase 12e
  // PRs. 150 is justified: the largest drained sub-module
  // (AccountScrapeFirstWave) measures well under 150 effective lines
  // (skipBlankLines + skipComments), comfortably inside the ceiling.
  //
  // Canary: `account-scrape-file-over-cap.canary.ts` over-sizes a file
  // so verify.sh confirms `max-lines` fires.
  {
    files: [
      'src/Scrapers/Pipeline/Strategy/Scrape/Account/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/account-scrape-file-over-cap.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 14f. PHASE 12e — ScrapeData file-size lock.
  //
  // `Strategy/Scrape/ScrapeDataActions.ts` was a 467-LoC (≈200 effective)
  // grab-bag helper module (rate limiting + date parsing + txn hashing +
  // dedup + POST-body templating + txn-URL build/resolve + account
  // assembly). §19.1 (below) pins Strategy/Scrape to per-function caps
  // (40 lines / 20 statements) but leaves the file-size (`max-lines`)
  // guard off. Phase 12e drains the file into co-located focused modules
  // under `Strategy/Scrape/ScrapeData/` (Dedup / Templating / Url /
  // Assembly) behind an unchanged barrel facade.
  //
  // Per `eslint-rules-guidlines.md` §1 (tighten when you split) this
  // block turns on the missing `max-lines` guard for the ScrapeData
  // sub-cluster + the barrel facade, pinning them to the canonical
  // 150-line Pipeline ceiling. §4 (narrow, never revert): scope is the
  // ScrapeData/ sub-tree + facade only — the last remaining over-cap
  // Strategy/Scrape file (MatrixLoopStrategy) gets its own file cap as it
  // is drained in the next Phase 12e PR. 150 is justified: the largest
  // drained sub-module (Templating) measures well under 150 effective
  // lines (skipBlankLines + skipComments), comfortably inside the ceiling.
  //
  // Canary: `scrape-data-file-over-cap.canary.ts` over-sizes a file so
  // verify.sh confirms `max-lines` fires. NOTE: this block locks the
  // file-size (`max-lines`) guard only; the matching per-function
  // (`max-lines-per-function` / `max-statements`) 10/10 lock for the
  // same sub-tree lives in §19.1b (after the §19.1 Strategy grandfather,
  // which would otherwise override it under flat-config last-wins).
  {
    files: [
      'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeData/**/*.ts',
      'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-data-file-over-cap.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 15. PHASE 3 COMMON ↔ PIPELINE UNIFICATION GUARD — Commit 11 (refactor/phase-3-common-unify).
  //
  // Closes Phase 3 Probe 3.4 (Pipeline → Common runtime imports = 0). Phase 3
  // collapsed every Common/* duplicate into a thin re-export shim that delegates
  // to the canonical Pipeline implementation; this rule prevents Pipeline
  // production code from ever importing back from Common/*, which would
  // re-introduce duplication and defeat the canonical-Pipeline mandate.
  //
  // The constant `PHASE3_COMMON_IMPORT_BAN_PATTERN` (defined above) uses a
  // regex with a negative lookahead so `Common/Config/BrowserConfig` is the
  // ONLY allowed Pipeline → Common edge (consumed by CamoufoxLauncher.ts).
  //
  // `ignores` here skips the scopes that already have their own
  // `no-restricted-imports` block (sections 8c/8d) where the same Common ban
  // pattern is merged into their patterns array. Without this, last-wins
  // semantics in flat config would clobber the scoped V5 isolation rules.
  {
    files: ['src/Scrapers/Pipeline/**/*.ts'],
    ignores: [
      'src/Scrapers/Pipeline/EslintCanaries/**',
      'src/Scrapers/Pipeline/Phases/BalanceResolve/**',
      'src/Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.ts',
      'src/Scrapers/Pipeline/Strategy/Scrape/**',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PHASE3_COMMON_IMPORT_BAN_PATTERN] }],
    },
  },

  // 15b. Phase 3 canary scope — re-enable the rule for the dedicated canary file.
  //
  // `EslintCanaries/**` is globally ignored at the top (line 509). `verify.sh`
  // runs ESLint with `--no-ignore` so canaries are parsed; this single-file
  // override re-attaches the Phase 3 rule so the canary's deliberate Common
  // import trips it. Mirrors the pattern used by every other canary in this file.
  //
  // CR PR #286 finding F3 added the `no-common-config-lookalike-in-pipeline`
  // canary — same regex, but its target import is a sibling Common/Config/*
  // module proving the negative-lookahead's `(?:\.js)?$` anchor pin works.
  {
    files: [
      'src/Scrapers/Pipeline/EslintCanaries/no-common-import-in-pipeline.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-common-config-lookalike-in-pipeline.canary.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PHASE3_COMMON_IMPORT_BAN_PATTERN] }],
    },
  },

  // 19. ZERO-DRIFT GLOBAL BASELINE — PR #304 CR follow-up.
  //
  // Phase H §8a + Mediator §14b.* locked `max-lines-per-function:10`,
  // `max-statements:10` for Pipeline/{Mediator,Phases,Network,Init,…}.
  // PR #304 CR finding #1 caught a 12-LoC method in
  // `src/Scrapers/Base/BaseScraperWithBrowser.ts` — outside that scope,
  // so ESLint stayed silent and the bad code shipped. This section
  // extends the strict cap to ALL `src/Scrapers/**` + `src/Common/**`
  // (the only remaining first-party production trees), then
  // grandfathers known existing debt via per-directory caps locked at
  // current state (commit 838de339).
  //
  // CONTRACT — NEW code MUST be ≤10/10. Modifying an existing function
  // beyond its directory's grandfather cap fails the pre-commit hook.
  // Refactoring should LOWER the caps in §19.grandfather; never raise.
  // Phase 9 target: drive every grandfather cap down to 10/10.
  //
  // Test files (`src/Tests/**`) keep their `max-lines-per-function:'off'`
  // exception (section 7) — tests are naturally long.

  // 19.0 BASELINE — strict 10/10 across all first-party production trees.
  {
    files: ['src/Scrapers/**/*.ts', 'src/Common/**/*.ts'],
    ignores: [
      'src/scrapers/**',
      'src/Scrapers/Pipeline/EslintCanaries/**',
      // …except the one canary that exists to certify THIS block. The
      // directory-wide ignore above means no canary can normally resolve
      // through §19.0, so the strict 10/10 baseline — the last-wins
      // declaration for the 65 `Mediator/Scrape` production files, and
      // the default that the §19.1-§19.3 grandfathers override elsewhere
      // — would have no canary coverage at all. Un-ignoring this single
      // file lets it resolve exactly as those 65 do, so relaxing §19.0
      // silences it.
      '!src/Scrapers/Pipeline/EslintCanaries/scrape-cluster-fn-over-cap.canary.ts',
      'src/Scrapers/Registry/**',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 10],
    },
  },

  // 19.1 GRANDFATHER — Pipeline/Strategy (heaviest debt: 16 files, 57+14).
  // TODO(phase-9): refactor Strategy/Scrape clusters to ≤10 LoC.
  {
    files: ['src/Scrapers/Pipeline/Strategy/**/*.ts'],
    rules: {
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 20],
    },
  },

  // 19.1a PHASE 12e — Scrape Executor per-function lock (drained sub-cluster).
  //
  // §19.1 (above) grandfathers ALL of `Strategy/**` to a loose 40-line /
  // 20-statement per-function cap. The Phase 12e drain split the
  // `ScrapeExecutor.ts` god-module into focused co-located modules under
  // `Strategy/Scrape/Executor/` (Types / Fetch / Account / Execute) whose
  // functions were authored fresh to the canonical 10-LoC ceiling — so
  // per `eslint-rules-guidlines.md` §1 (tighten when you split) this block
  // pins the drained sub-tree + facade back to the strict 10/10 cap that
  // §19.0 sets for all new first-party code. Flat-config is last-wins and
  // this block sits AFTER §19.1, so the strict cap deterministically wins
  // for these paths while the rest of Strategy/** keeps its grandfather.
  // §4 (narrow, never revert): scope is the Executor sub-tree + facade
  // only — the remaining over-cap Strategy/Scrape files keep §19.1's cap
  // until they are drained in subsequent Phase 12e PRs.
  //
  // Canary: `scrape-executor-fn-over-cap.canary.ts` over-sizes one
  // function so verify.sh confirms `max-lines-per-function` fires.
  {
    files: [
      'src/Scrapers/Pipeline/Strategy/Scrape/Executor/**/*.ts',
      'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeExecutor.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-executor-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-statements': ['error', 10],
    },
  },

  // 19.1b PHASE 12e — ScrapeData per-function lock (drained sub-cluster).
  //
  // §19.1 (above) grandfathers ALL of `Strategy/**` to a loose 40-line /
  // 20-statement per-function cap. The Phase 12e drain split the
  // `ScrapeDataActions.ts` god-module into focused co-located modules
  // under `Strategy/Scrape/ScrapeData/` (Dedup / Templating / Url /
  // Assembly) whose functions were authored fresh to the canonical
  // 10-LoC ceiling — so per `eslint-rules-guidlines.md` §1 (tighten when
  // you split) this block pins the drained sub-tree + barrel facade back
  // to the strict 10/10 cap that §19.0 sets for all new first-party code.
  // Flat-config is last-wins and this block sits AFTER §19.1, so the
  // strict cap deterministically wins for these paths while the rest of
  // Strategy/** keeps its grandfather. §4 (narrow, never revert): scope
  // is the ScrapeData sub-tree + facade only — the remaining over-cap
  // Strategy/Scrape file (MatrixLoopStrategy) keeps §19.1's cap until it
  // is drained in the next Phase 12e PR.
  //
  // CodeRabbit PR #358 caught this gap: §14f added the file-size cap but
  // left the per-function cap at §19.1's loose 40, so oversized drained
  // functions shipped. This block + `scrape-data-fn-over-cap.canary.ts`
  // close it (verify.sh confirms `max-lines-per-function` fires).
  {
    files: [
      'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeData/**/*.ts',
      'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-data-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-statements': ['error', 10],
    },
  },

  // 19.2 GRANDFATHER — Pipeline/Types (6 files, 24+4).
  //   EXCLUDES `Pipeline/Types/PiiRedactor/**` — that cluster is
  //   locked at canonical 10/10 by §13 and the guideline-coverage
  //   gate (`lint-guideline-coverage.ts`) actively enforces it.
  //   Flat-config is last-wins, so a broad block here would silently
  //   regress §13's PII security cap.
  {
    files: ['src/Scrapers/Pipeline/Types/**/*.ts'],
    ignores: ['src/Scrapers/Pipeline/Types/PiiRedactor/**/*.ts'],
    rules: {
      'max-lines-per-function': ['error', { max: 30, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 20],
    },
  },

  // 19.2a RE-TIGHTEN — Pipeline/Types/Domain back to the canonical 10.
  //   §19.2 above is BROADER than the earlier `Types/Domain/**` block
  //   (which sets `max-lines-per-function: 10`) and lands LATER, so
  //   flat-config last-wins silently raised Domain from 10 to 30. The
  //   earlier block's own comment states the intent — "any future
  //   runtime code in this folder must fit within 10 LoC" — and its
  //   canary lives outside `Types/**`, so it kept firing at 10 while
  //   production Domain files resolved to 30, hiding the regression.
  //   All 20 Domain files already satisfy 10, so this restores the
  //   declared intent without draining anything.
  {
    files: [
      'src/Scrapers/Pipeline/Types/Domain/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/types-domain-fn-over-10.canary.ts',
    ],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 19.3 GRANDFATHER — Pipeline/Core + Phases + Interceptors + Banks + Registry.
  {
    files: [
      'src/Scrapers/Pipeline/Core/**/*.ts',
      'src/Scrapers/Pipeline/Phases/**/*.ts',
      'src/Scrapers/Pipeline/Interceptors/**/*.ts',
      'src/Scrapers/Pipeline/Banks/**/*.ts',
      'src/Scrapers/Pipeline/Registry/**/*.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 15, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 10],
    },
  },

  // 19.3a GRANDFATHER — Pipeline/Phases/Base/BasePhase.ts (Phase 12b — BasePhase migration target).
  //   Phase 12b decoupled the mislabeled 633-LoC `Pipeline/Types/BasePhase.ts`
  //   hub: the BasePhase abstract class + its helper functions move into
  //   their semantically correct sibling location, `Pipeline/Phases/Base/`,
  //   leaving `Types/BasePhase.ts` as a thin re-export shim for the v8.5
  //   release window.
  //
  //   SCOPE NARROWED + DRAINED (CR PR #338 iteration 2): the eight stage
  //   orchestrators (`runStages`, `runStagesAfterPre`, `handleStage`,
  //   `takePhaseScreenshot`, `runPre`, `runAction`, `runPost`, `runFinal`)
  //   were reduced to fit the §19.3 cap of 15 by extracting six helpers.
  //   They are NOT all ≤10: `runStagesAfterPre` (15), `runPost` (13),
  //   `runFinal` (13), `handleStage` (12) and `takePhaseScreenshot` (11)
  //   still exceed the canonical 10 and await the Base cap-10 rollout.
  //   The six extracted helpers are:
  //     • `wrapStageThrow<T>`     — try/catch envelope (CR F3 — promotes
  //       thrown stage exceptions into structured Procedure failures so
  //       the runtime contract is uniform across happy + sad paths)
  //     • `snapshotPreFail`       — PRE-fail screenshot extraction
  //     • `capturePageScreenshot` — split from takePhaseScreenshot
  //     • `logStage<T>`           — central phase-stage debug emit
  //     • `mockShortCircuit<T>`   — MOCK_MODE Option<Procedure<T>> short-circuit
  //     • `mergeActionResult`     — ACTION's IActionContext → IPipelineContext merge
  //   The per-function (`max-lines-per-function`) + per-method
  //   (`max-statements`) overrides have been DELETED entirely — global
  //   §19.3 (15/10) now applies. Only `max-lines: 'off'` remains because
  //   the abstract Template Method file legitimately exceeds the 300-LoC
  //   global cap (~520 LoC after all six extractions + their typedoc) —
  //   same precedent §7 grants to `Pipeline/{Mediator,Strategy,Types}/**`.
  //
  //   Flat-config is last-wins, so this block MUST appear after §19.3.
  {
    files: ['src/Scrapers/Pipeline/Phases/Base/BasePhase.ts'],
    rules: {
      // ~520 LoC Template Method abstract class. Same `max-lines: off`
      // precedent §7 grants to `Pipeline/{Mediator,Strategy,Types}/**`.
      // Per-function caps inherited from §19.3 — no override. Those are
      // `max-lines-per-function: 15` and `max-statements: 10`, NOT 10/10:
      // six methods here still measure 11–15 effective lines, so this file
      // awaits the Base cap-10 rollout CLEAN_CODE.md tracks as follow-up.
      'max-lines': 'off',
    },
  },

  // 19.4 GRANDFATHER — Pipeline/Mediator/{Elements,Form} (not covered by
  // existing §14b.* cluster blocks; Network already passes 10/10).
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Elements/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Form/**/*.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 12],
    },
  },

  // 19.4a PHASE 12d TIGHTENING — Form sub-folders to canonical 10/10.
  //
  // Phase 12d split the three HIGH-tier Form blobs
  // (`LoginFormActions.ts`, `FormAnchor.ts`, `FormErrorDiscovery.ts`)
  // into focused sub-folders under `Mediator/Form/{Actions,Anchor,
  // ErrorDiscovery}/`. Per eslint-rules-guidlines §1 ("Always tighten
  // the ceiling in the same PR so the next blob cannot grow back to
  // the old budget") + §4 ("never revert, only narrow"), this block
  // narrows §19.4's grandfather `max: 20` down to the canonical
  // `max: 10` for the three NEW sub-folders only. The legacy
  // `Mediator/Form/*.ts` files (LoginFormFill.ts, LoginScopeResolver.ts,
  // OtpProbe.ts, PostActionResolver.ts) keep §19.4's cap-20 until
  // their own dedicated drain phase.
  //
  // Flat-config last-wins: this block MUST appear after §19.4.
  //
  // Companion canary: `form-sub-fn-over-cap.canary.ts` exhibits the
  // banned shape so `verify.sh` asserts the rule fires on every
  // commit (eslint-rules §2 "every numeric rule MUST have one").
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Form/Actions/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Form/Anchor/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Form/ErrorDiscovery/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/form-sub-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-statements': ['error', 10],
    },
  },

  // §19.4b REMOVED (CR PR #345 hardening):
  // The previous browser-eval cap-20 grandfather for `AnchorWalk.ts` +
  // `ErrorDiscoveryScan.ts` is no longer needed. Phase 12d-final
  // decoupled the in-browser closures into sibling files
  // (`AnchorWalkBrowser.ts`, `ErrorDiscoveryScanBrowser.ts`) under a
  // column-array data contract — each closure is now self-contained
  // and ≤10 LoC, and the Node-side zip helpers fit cap-10 too.
  // The OCP/SRP-compliant decoupling supersedes the carve-out per
  // CLEAN_CODE.md + guidelines (no permanent exceptions for cap-10).

  // 19.5 GRANDFATHER — legacy bank scrapers + Base + Common.
  // The base classes + bank-specific scrapers carry the deepest debt.
  // Phase 9 plans a per-bank refactor pass to bring each ≤10/10.
  {
    files: [
      'src/Scrapers/Base/**/*.ts',
      'src/Scrapers/Leumi/**/*.ts',
      'src/Scrapers/Yahav/**/*.ts',
      'src/Scrapers/Mizrahi/**/*.ts',
      'src/Scrapers/BeyahadBishvilha/**/*.ts',
      'src/Scrapers/Behatsdaa/**/*.ts',
      'src/Common/**/*.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 12],
    },
  },

  // 19.6 SKIPPED-TEST BAN — extend `sonarjs/no-skipped-tests` (S1607)
  // to ALL `src/Tests/**`. Previously scoped out (§11 ignores) so
  // `describe.skip(...)` could silently land. Probe confirmed S1607
  // fires on UNCONDITIONAL `describe.skip('...')` only — the
  // creds-gated `hasCreds ? describe : describe.skip` pattern used in
  // E2eReal/E2eFull tests is NOT caught (it accesses `.skip` as a
  // property reference, not a call), so legitimate creds-gating
  // stays allowed without exceptions.
  {
    files: ['src/Tests/**/*.ts'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/no-skipped-tests': 'error',
    },
  },

  // 19.7 PHASE 7.5 SKIP ALLOW-LIST — 7 e2e-mocked tests with
  // unconditional `describe.skip(...)` awaiting fixture capture
  // (tasks/phase-7-5-T8-T12). Each entry MUST be removed from this
  // list when its test is unskipped (the rule then fires if any
  // `.skip` remains, blocking the merge). Shared with the parity
  // canaries via `eslint.canary-scope.mjs`.
  {
    files: [...SKIP_ALLOWLIST_FILES],
    rules: {
      'sonarjs/no-skipped-tests': 'off',
    },
  },

  // 19.8 TEST STATEMENT CAP — extend `max-statements` to `src/Tests/**`.
  // Tests legitimately have long `describe(...)` / `it(...)` arrow
  // callbacks (setup + multiple assertions), so we keep
  // `max-lines-per-function: 'off'` from §7. But `max-statements: 30`
  // is a meaningful cap: it catches truly bloated test functions
  // (a single test with 30+ statements is doing too much) without
  // touching the natural arrow-callback length of describe-blocks.
  // Phase 9 should drive this cap down to 15.
  {
    files: ['src/Tests/**/*.ts'],
    rules: {
      'max-statements': ['error', 30],
    },
  },

  // 19.9 CANARY — TEST-HELPER FUNCTION-DECLARATION ≤10-STMT CAP.
  //
  // The §19.9 rule (defined inline in §4 + §5) bans FunctionDeclaration
  // bodies > 10 stmts inside `src/Tests/**`.
  //
  // The canary-only block that used to live here re-enabled the rule on one
  // fixture under `EslintCanaries/` — and, being a `no-restricted-syntax`
  // re-declaration, it REPLACED the whole set for that file, leaving it with
  // exactly one selector. §22 now arms the rule across every canary as part
  // of the canary contract, so a single fixture no longer buys its coverage
  // by discarding everyone else's.

  // 19.10 TEST-HELPER LINE CAP — `fn-declaration-max-lines:10` on the
  // 6 Phase 9 files. Closes the lines-vs-statements gap CR cycle 2
  // exposed (named helpers of 21 lines / 5 stmts slipped through §19.9
  // because AST selectors cannot compute line counts). Phase 10 master
  // plan extends the `files:` glob to all `src/Tests/**` in waves.
  {
    files: PHASE_9_TEST_FILES,
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },

  // 19.10 PHASE 10 WAVE 1 — extend `fn-declaration-max-lines:10` to the
  // Mode A/B harvester + simulator tree under `src/Tests/Integration/**`
  // and its companion unit tests. Closes the gap CR cycle 4b exposed
  // (17 helper functions >10 lines slipped through because the directory
  // was not in the §19.10 allowlist). Future Integration files inherit
  // automatically via the glob.
  //
  // The `ignores:` list grandfathers 4 pre-existing files that were
  // NOT touched by PR-A2.1 (Banks/, Helpers/, LoginNavigation, Check…
  // Coverage). Phase 10 wave 2 brings those under the cap in a focused
  // refactor PR — avoiding scope creep on PR-A2.1.
  {
    files: PHASE_10_INTEGRATION_FILES,
    // PR-321 cycle-1 (CR finding #1): the previous glob
    // 'src/Tests/Integration/Banks/**/*.ts' was too broad and grandfathered
    // every NEW Mode A bank test out of §19.10. Narrow to the only legacy
    // Phase 10 file under Banks/ so Mode A tests are enforced going forward.
    //
    // Same correction applied to Helpers/: the glob
    // 'src/Tests/Integration/Helpers/**/*.ts' exempted every helper,
    // including ones added later, so a new helper could exceed the cap
    // while linting clean. Only MirrorInterceptor.ts actually needs the
    // exemption (routeHandler 17, readCapturedSteps 11, installMirror 11);
    // the other five helpers already comply, so naming the one file costs
    // nothing and puts new helpers under the cap.
    ignores: [
      'src/Tests/Integration/Banks/LoginFormDiscovery.integration.test.ts',
      'src/Tests/Integration/Helpers/MirrorInterceptor.ts',
      'src/Tests/Integration/Mirror/LoginNavigation.mirror.test.ts',
      'src/Tests/Integration/Tools/CheckBankIntegrationCoverage.ts',
    ],
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },

  // 19.10 CANARY — re-enable the rule on a single fixture under
  // `EslintCanaries/` (globally ignored at line 539) so `verify.sh` can
  // confirm the guardrail stays armed. Fixture is 12 lines / 5 stmts —
  // proves §19.10 fires on a function §19.9 would miss.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/test-helper-over-10-lines.canary.ts'],
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },

  // 19.11 PHASE 10 WAVE 2 — Pipeline coverage-closeout tests (PR #336
  // Seq #1) MUST mirror the production ≤10-LoC cap. CR cycle #1 caught
  // a 12-LoC `buildEndpoint` helper inside `ApiOriginDiscovery.test.ts`
  // that ESLint silently allowed — because §7's broad `src/Tests/**`
  // override at line 866 turns `max-lines-per-function` OFF entirely.
  //
  // Why only `phase9-local/fn-declaration-max-lines` here (and NOT the
  // built-in `max-lines-per-function` / `max-statements`): the built-in
  // rules fire on EVERY `describe`/`it` arrow callback (per the §19.10
  // docstring, ~3 049 violators in `src/Tests/**` per AST audit) which
  // makes them unusable on test files. The phase9-local rule fires
  // ONLY on named `FunctionDeclaration`s — exactly the slip-class CR
  // cycle #1 exposed (`function buildEndpoint() {}` over 10 lines).
  // Statement-count enforcement is already provided by
  // `TEST_HELPER_OVER_10_STMTS_RULE` wired into §7's `no-restricted-syntax`
  // at line 877 — so we don't double up here.
  //
  // Globs are deliberately narrow: the 3 files PR #336 added + the
  // Scoring/** glob so future co-located tests inherit. A wave 3
  // widens to all `src/Tests/Unit/Pipeline/**` after the existing
  // 2 317 violators are drained (Phase 9-style sweep).
  {
    files: PHASE_10_WAVE_2_PIPELINE_HARDENING_TESTS,
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },

  // 19.11 CANARY — re-enable §19.11 on a single fixture under
  // `EslintCanaries/` (globally ignored at line 539) so `verify.sh`
  // can confirm the wave-2 guardrail stays armed. Fixture is a
  // 14-line named FunctionDeclaration — proves the wave-2 rule
  // fires on the slip-class CR cycle PR #336 #1 exposed.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/test-pipeline-hardening-fn-over-cap.canary.ts'],
    plugins: { 'phase9-local': phase9LocalPlugin },
    rules: {
      'phase9-local/fn-declaration-max-lines': ['error', { max: 10 }],
    },
  },

  // 21. RULE #10 — NO RAW `page` IN PIPELINE BUSINESS LOGIC.
  //     The ban existed only under `src/Tests/**/Pipeline/**` (§5), so it had
  //     never once run against production. Selector + its known blind spots are
  //     documented on `RULE10_NO_RAW_PAGE_RULE` above — read that before
  //     assuming this glob makes a layer Playwright-free.
  //
  //     SCOPE — the five layers that are business logic: Phases, Core, Banks,
  //     Registry, Logging. One production file is trapped and grandfathered in
  //     §21a, so this is NOT a ratchet over wholly clean ground.
  //
  //     EXCLUDED, and why each is a judgement call rather than a settled fact:
  //       • Mediator — is the browser boundary by definition (P7). Settled.
  //       • Strategy — `IFetchStrategy` implementations the ApiMediator selects
  //         at runtime (P4). Being *chosen by* the Mediator is not the same as
  //         *being* the Mediator, so this exclusion is arguable; 5 call sites.
  //       • Interceptors — DOM-snapshot / WAF capture, inherently page-bound;
  //         8 call sites.
  //       • Types — NOT a principled exclusion. `Types/FixtureCapture.ts` is a
  //         misplaced capture helper with 2 call sites; it belongs under
  //         Mediator or Interceptors. Excluded only to keep this commit to one
  //         guardrail change (eslint-rules-guidlines.md §5).
  //     Bringing any of the three latter layers in-scope is a follow-up worth
  //     doing; it needs ~15 grandfather entries and a maintainer decision.
  //
  //     `PIPELINE_SYNTAX_RULES` is spread rather than listing selectors here
  //     because flat config REPLACES a rule's options rather than merging them
  //     — omitting it would strip the guards that the `src/**/*.ts` block (§14)
  //     establishes for these files. That constant already unions
  //     `RESTRICTED_SYNTAX_RULES`, §6's richer `RESTRICTED_SYNTAX_RULES_NEW`
  //     and `PIPELINE_REVIEW_RULES` (minus the drain queue), so §6's extra
  //     selectors ARE in force on these paths.
  {
    files: [
      'src/Scrapers/Pipeline/Phases/**/*.ts',
      'src/Scrapers/Pipeline/Core/**/*.ts',
      'src/Scrapers/Pipeline/Banks/**/*.ts',
      'src/Scrapers/Pipeline/Registry/**/*.ts',
      'src/Scrapers/Pipeline/Logging/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, RULE10_NO_RAW_PAGE_RULE],
    },
  },

  // 21a. RULE #10 GRANDFATHER — BindApiMediatorClientVersion.ts.
  //     The one production file the §21 ratchet trapped. `discoverClientVersion`
  //     takes a raw `Page` and calls `page.evaluate(...)` to read the SPA build
  //     version out of the resource-timing buffer. It is a genuine P7 breach:
  //     browser access belongs to the Mediator.
  //
  //     NOT fixed here on purpose. `IApiMediator` exposes no evaluate-style
  //     capability, so closing it means adding one to the Mediator surface and
  //     reshaping the 7 assertions in
  //     src/Tests/Unit/Pipeline/Phases/BindApiMediator/BindApiMediatorClientVersion.test.ts.
  //     eslint-rules-guidlines.md §5 requires a guardrail commit to touch only
  //     the config + canaries and stay separable from the refactor that drains
  //     it. TARGET: move the scan behind a Mediator method, then DELETE this
  //     block — it must never be widened (§4: narrow scope, never raise a cap).
  //
  //     Grandfathered by re-declaring the array WITHOUT RULE10_NO_RAW_PAGE_RULE
  //     rather than switching the rule `off`, so the §14 screenshot guard and
  //     the shared restricted-syntax set stay enforced on this file.
  //     `eslint-disable` is banned outright (§3 + §15).
  //
  //     ACCEPTED RISK: this exempts the FILE, not the one known call. A second
  //     `page.*` call added here would not be caught. A per-occurrence cap
  //     needs the type-aware custom rule noted on RULE10_NO_RAW_PAGE_RULE;
  //     until then the mitigation is to drain this block, not to widen it.
  {
    files: ['src/Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorClientVersion.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES],
    },
  },

  // 20. SHAPE TRANSACTIONS WINDOW-END LOCK — added 2026-06 with the
  //     window-coverage backfill.
  //
  //     The backfill re-asks a bank for an older slice by handing the shape a
  //     context whose `windowEnd` is narrowed. That only reaches the wire while
  //     `scrapeWindowEnd(ctx)` is the single place the window's end is decided,
  //     so a shape that reads the clock directly silently opts out of the
  //     backfill and re-introduces the transaction loss it exists to close.
  //     The rule's rationale, and the window contract it protects, are
  //     documented in docs/phases/api-direct-scrape.md ("Window upper bound —
  //     `scrapeWindowEnd` and the `windowNarrowing` declaration"); this rule
  //     keeps a call site that bypasses it from appearing.
  //
  //     `RESTRICTED_SYNTAX_RULES` and `NO_DIRECT_SCREENSHOT_RULE` are re-spread
  //     because flat config REPLACES a rule's options rather than merging them
  //     — omitting them would silently weaken §6 and §14 on these files.
  //
  //     OneZeroShapeTxns.ts is excluded, not grandfathered: OneZero is declared
  //     `providerCursor` and has no upper bound to narrow. Its single clock read
  //     computes the provider's absolute one-year floor on the window's START
  //     (`max(options.startDate, 1y ago)`), which must stay pinned to wall-clock
  //     now — measuring it from a narrowed end would let the walk ask for data
  //     older than the provider serves.
  //
  //     Widened 2026-08 (Phase 4) from `Banks/**/scrape/` to also cover
  //     `Phases/ApiDirectScrape/**`: a bank family that shares one neutral
  //     `*ShapeTxns.ts` factory moves the wire's window bound out of the bank
  //     folder, and a path-keyed rule would have dropped the guardrail exactly
  //     where several banks now depend on it at once. The glob is widened, never
  //     narrowed — coverage only grows (eslint-rules-guidlines.md §1/§4).
  {
    files: [
      'src/Scrapers/Pipeline/Banks/**/scrape/*ShapeTxns.ts',
      'src/Scrapers/Pipeline/Phases/ApiDirectScrape/**/*ShapeTxns.ts',
    ],
    ignores: ['src/Scrapers/Pipeline/Banks/OneZero/scrape/OneZeroShapeTxns.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PIPELINE_SYNTAX_RULES,
        SHAPE_TXNS_WINDOW_END_RULE,
        RULE10_NO_RAW_PAGE_RULE,
      ],
    },
  },

  // 22. CANARY DIRECTORY — the full contract, nothing drained.
  //
  // Placed last (before the per-file exemptions) so no earlier block can
  // narrow it. Canaries exist to prove a selector still fires; a canary whose
  // target had been drained or overwritten would pass on incidental lint noise
  // — which is exactly how `readonly-set-instead-of-const` and
  // `as-unknown-as-double-cast` sat green while certifying nothing.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/**/*.canary.ts'],
    rules: { 'no-restricted-syntax': ['error', ...PIPELINE_CANARY_SYNTAX_RULES] },
  },

  // 22a. CANARY FILE-SPECIFIC RULES — the contract plus what one canary certifies.
  //
  // Generated from CANARY_EXTRA_RULES and emitted after §22 so the base
  // contract cannot swallow a canary's own target. `check-syntax-guardrails`
  // proves each entry resolves on the canary that declares it.
  ...CANARY_EXTRA_BLOCKS,

  // 23. CONTRACT EXEMPTIONS — last, so nothing can overwrite them.
  //
  // Generated from PIPELINE_SELECTOR_EXEMPTIONS so the table a reviewer reads
  // is the table ESLint applies and the one `check-syntax-guardrails` subtracts.
  // Each entry re-declares the full contract MINUS the named selectors, never
  // `'no-restricted-syntax': 'off'` — `off` excuses one selector by lifting all
  // of them, which is how `PiiRedactor/Types.ts` came to run unguarded.
  //
  // The file is passed to `pipelineSyntaxExcept` so scoped selectors (§12C)
  // survive: rebuilding from the global contract alone silently disarmed them
  // on the three exempted files that sit inside the canonical-10 folders.
  ...Object.entries(PIPELINE_SELECTOR_EXEMPTIONS).map(([file, exempt]) => ({
    files: [file],
    rules: { 'no-restricted-syntax': pipelineSyntaxExcept(exempt, file) },
  })),

  // 24. LEGACY READERS OF LEGACY-ONLY SCRAPER OPTIONS
  //
  //     Sits after §23 without weakening it. §23's "last" invariant governs
  //     `no-restricted-syntax`; this block sets a different rule
  //     (`@typescript-eslint/no-deprecated`) on a file set disjoint from every
  //     Pipeline path §22/§22a/§23 match, so neither can narrow the other.
  //
  //     Eight fields on the public `ScraperOptions` type carry `@deprecated`
  //     (src/Scrapers/Base/Interface.ts) because only the Legacy (deprecated)
  //     scrapers read them — every Pipeline bank ignores them, which issue #540
  //     reported as a silent drop. The tag is the point: it strikes the option
  //     through in a consumer's editor before their code ever runs, which the
  //     runtime `ScraperOptionsWarning` cannot do.
  //
  //     The cost is that the legacy files IMPLEMENTING those options now read a
  //     deprecated symbol, so `@typescript-eslint/no-deprecated` (inherited from
  //     `strictTypeChecked`) fires 13 times across the six files below. That is
  //     the rule working as designed on code that is deprecated by definition.
  //
  //     Scope is enumerated file-by-file, never a glob, so the rule keeps full
  //     force everywhere else — in particular across all of
  //     `src/Scrapers/Pipeline/**`, where a file reading one of these options
  //     would be a genuine defect and must still fail lint. Per
  //     eslint-rules-guidlines.md §3 this is a `files: […]` override, not an
  //     `eslint-disable` header (which §15 `no-warning-comments` bans outright).
  //
  //     Removal condition: this block loses an entry every time a legacy bank
  //     migrates to the Pipeline (docs/architecture/migration.md step 6), and
  //     disappears when the legacy path is deleted. It may only ever be
  //     narrowed, never widened (eslint-rules-guidlines.md §4).
  {
    files: [
      'src/Common/OtpHandler.ts',
      'src/Scrapers/Base/BaseScraperWithBrowser.ts',
      'src/Scrapers/Behatsdaa/BehatsdaaScraper.ts',
      'src/Scrapers/BeyahadBishvilha/BeyahadBishvilhaScraper.ts',
      'src/Scrapers/Mizrahi/MizrahiConverters.ts',
      'src/Scrapers/Mizrahi/MizrahiScraper.ts',
    ],
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
);
