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
  {
    // Blocks 'null' or 'undefined' in Type Annotations for functions/methods
    selector:
      ":matches(TSFunctionType, TSMethodDefinition, FunctionDeclaration) TSTypeAnnotation :matches(Identifier[name='null'], Identifier[name='undefined'], TSNullKeyword, TSUndefinedKeyword)",
    message:
      "🚫 ARCHITECTURE: Functions cannot return 'null' or 'undefined'. Use a Result Pattern (e.g., IScraperResult).",
  },
  {
    // Blocks 'void' as a return type (Forces every function to return data)
    selector:
      ':matches(TSFunctionType, TSMethodDefinition, FunctionDeclaration) TSTypeAnnotation > TSVoidKeyword',
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
  // RESTRICTED_SYNTAX_RULES_NEW (Pipeline-scoped). Common/legacy scrapers
  // use a separate `Common/Debug.js` and are intentionally exempt.

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
    'page.screenshot(...) — use safeScreenshot() from src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts (PII-safe CI gate). The src/Common/SafeScreenshot.ts shim is deprecated since v8.5; new imports MUST use the canonical Pipeline path.',
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

// §19.10 enforcement scope — Phase 9 6 files. Extend in Phase 10.
const PHASE_9_TEST_FILES = [
  'src/Tests/E2eReal/Helpers.ts',
  'src/Tests/E2eReal/Tools/CaptureInvalidLogin.ts',
  'src/Tests/Tools/probe-beinleumi-nth.ts',
  'src/Tests/Unit/Pipeline/Infrastructure/DashboardPhase.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/AuthDiscovery/AuthDiscoveryFactoryTest.test.ts',
  'src/Tests/Unit/Pipeline/Mediator/BalanceResolve/BalanceResolveCrossBank.test.ts',
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
  {
    // UPDATED: TSMethodDefinition -> MethodDefinition
    selector:
      ":matches(TSFunctionType, MethodDefinition, FunctionDeclaration) TSTypeAnnotation :matches(Identifier[name='null'], Identifier[name='undefined'], TSNullKeyword, TSUndefinedKeyword)",
    message:
      "🚫 ARCHITECTURE: Functions cannot return 'null' or 'undefined'. Use a Result Pattern (e.g., IScraperResult).",
  },
  {
    // UPDATED: TSMethodDefinition -> MethodDefinition
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
  {
    // Phase 2 close-out — C4 catch-as-Error ban (Bucket A/B/C drained
    // in C1-C3). TypeScript's catch parameter is `unknown` in strict
    // mode; `error as Error` silently mislabels non-Error throws
    // (null, undefined, primitives, plain objects, cross-realm Error,
    // throwing toString). Use `toErrorMessage(error)` for messages or
    // `toError(error)` for an Error handle — both from
    // `src/Scrapers/Pipeline/Types/ErrorUtils.ts`.
    selector: "CatchClause TSAsExpression > TSTypeReference > Identifier[name='Error']",
    message:
      '🚫 ARCHITECTURE: `error as Error` is banned inside catch clauses. ' +
      'Use `toErrorMessage(error)` (for messages) or `toError(error)` (for an Error handle) ' +
      'from `src/Scrapers/Pipeline/Types/ErrorUtils.ts` — `unknown` catch parameters can be ' +
      'non-Error throws and the cast hides those bugs.',
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
      'no-warning-comments': [
        'error',
        {
          terms: [
            'todo',
            'fixme',
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
        {
          // Type Bypasses (as never / as any)
          selector: 'TSAsExpression > :matches(TSNeverKeyword, TSAnyKeyword)',
          message:
            "🚫 TEST INTEGRITY: Do not use 'as never' or 'as any' in mocks. Use 'DeepPartial<T>' or implement the required interface.",
        },
        {
          selector: 'ExportDefaultDeclaration',
          message:
            "🚫 ARCHITECTURE: Named exports only. Do not use 'export default' in Pipeline/Strategy files.",
        },
        {
          selector: "CallExpression[callee.object.name='page']",
          message: "🚫 Rule #10: Direct calls to 'page' are forbidden. Use ctx.mediator instead.",
        },
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
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES_NEW,
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
          selector:
            'BinaryExpression[operator=/^[!=]==$/][left.type="MemberExpression"][left.property.name="success"][right.type="Literal"][right.value=/^(true|false)$/]',
          message:
            '🚫 PROCEDURE: Use `isOk(result)` instead of `result.success === true/false`. Keeps narrowing + call-site consistency aligned across the codebase.',
        },
      ],

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

  // 8. PHASE ROOT GUARD (THE FINAL CHECK)
  {
    files: ['src/Scrapers/Pipeline/Phases/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
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
  // sneaking back in. The canary file deliberately uses the literal
  // so verify.sh can confirm the rule fires.
  {
    files: [
      'src/Scrapers/Pipeline/Strategy/Scrape/ScrapeDataActions.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-balance-in-scrape.canary.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='balance']",
          message:
            "🚫 V5 ISOLATION (T50): The literal 'balance' is forbidden in ScrapeDataActions.ts. Balance resolution belongs to the BALANCE-RESOLVE phase.",
        },
      ],
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

  // 8g. BALANCE-RESOLVE QUARANTINE INTEGRITY (PR #264 CR finding #4)
  //
  // Every `await api.fetchPost(...)` / `await api.fetchGet(...)` inside
  // the BALANCE-RESOLVE mediator MUST be wrapped in a TryStatement so a
  // thrown exception from one bank account's network call does not
  // reject the surrounding `Promise.all` and abort every sibling fetch.
  // The `safeIssueOneFetch` helper is the canonical wrapper.
  //
  // Scope = the production mediator file + the dedicated canary fixture
  // so `verify.sh` proves the rule actually fires.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.ts',
      'src/Scrapers/Pipeline/EslintCanaries/balance-resolve-throw-leaks-quarantine.canary.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        {
          selector: 'AwaitExpression > CallExpression[callee.property.name=/^fetch(Post|Get)$/]',
          message:
            '🚫 BALANCE-RESOLVE QUARANTINE (CR #264 Critical): wrap `await api.fetch*` in safeIssueOneFetch (try/catch) so a thrown fetch cannot abort the Promise.all loop and break per-bank-account quarantine.',
        },
      ],
    },
  },

  // 8h. BALANCE-RESOLVE BULK_KEY CONSTANTS (PR #264 CR finding #7)
  //
  // The string literal `'__BULK__'` is the planner's bulk-key sentinel
  // and lives only in `BalanceFetchPlanner.ts`. Every consumer must
  // import the named constant `BULK_KEY` from there so the value can
  // be renamed atomically. Hardcoded copies drift silently when the
  // sentinel changes.
  //
  // Scope = the BALANCE-RESOLVE mediator consumer + canary.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.ts',
      'src/Scrapers/Pipeline/EslintCanaries/balance-resolve-bulk-literal.canary.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        {
          selector: "Literal[value='__BULK__']",
          message:
            "🚫 BALANCE-RESOLVE CONSTANTS (CR #264 Major): use the named BULK_KEY constant imported from BalanceFetchPlanner instead of the hardcoded '__BULK__' literal.",
        },
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
  // Scope = api-direct phase that emits balanceResolution + canary.
  {
    files: [
      'src/Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.ts',
      'src/Scrapers/Pipeline/EslintCanaries/balance-default-zero.canary.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        {
          selector: "LogicalExpression[operator='??'][left.property.name='balance'][right.value=0]",
          message:
            '🚫 BALANCE DEFAULT-DENY (CR #264 Major): `acc.balance ?? 0` collapses unknown into a real zero. Skip the entry (or surface a typed failure) instead.',
        },
        {
          selector:
            "LogicalExpression[operator='??'][left.property.name='balance'][right.raw='null']",
          message:
            '🚫 BALANCE DEFAULT-DENY (CR #264 Major): `acc.balance ?? null` is forbidden for the same reason as `?? 0` — use a typed skip.',
        },
      ],
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
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/Tests/**',
      'src/Common/**',
      'src/Scrapers/Behatsdaa/**',
      'src/Scrapers/BeyahadBishvilha/**',
      'src/Scrapers/Leumi/**',
      'src/Scrapers/Mizrahi/**',
      'src/Scrapers/Yahav/**',
      'src/Scrapers/Registry/**',
      'src/scrapers/**',
    ],
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
      'unicorn/prefer-export-from': ['error', { ignoreUsedVariables: true }], // S7763
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
    },
  },

  // 12e. RE-EXPORT SHORTHAND (Security Hardening 2026-05) — scoped
  //      flip of `unicorn/prefer-export-from` `ignoreUsedVariables`
  //      under `src/Scrapers/Base/**` AND `src/Scrapers/Pipeline/Types/**`.
  //      Decide §4 RC-8 OPTION-B: keeps the global default at `true`
  //      to avoid surfacing the 10 collateral hits as in-scope; flips
  //      locally so the rule fires on `BaseScraperWithBrowser.ts` after
  //      the manual rewrite.
  //
  //      PR #274 extension — Pipeline/Types covered to match Sonar
  //      `typescript:S7763`. The PR #274 review surfaced 11 instances of
  //      `import type { X } from './Domain/...js'; export type { ..., X }`
  //      in `PipelineContext.ts`; with `ignoreUsedVariables: true` the
  //      global rule treats the barrel-export reference as "used" and
  //      skips. Flipping the flag for `Pipeline/Types/**` makes ESLint
  //      catch the same anti-pattern locally on the next commit so the
  //      Sonar failure cannot recur. Production code base is unchanged
  //      by this extension (the 11 PR #274 sites are converted to direct
  //      `export type ... from` in the same commit).
  {
    files: [
      'src/Scrapers/Base/**/*.ts',
      'src/Scrapers/Pipeline/Types/**/*.ts',
      // Phase 8.5c / Commit T1 — extend scope to the re-export-shorthand
      // canary so it can trip its target rule. Without this single-file
      // entry the canary lives outside §12e's scope and silently passes
      // (errorCount=0 with --no-ignore). T1's rewritten verify.sh now
      // rejects any canary that produces zero real rule-IDs, so the
      // canary must be made functional alongside the harness fix.
      'src/Scrapers/Pipeline/EslintCanaries/re-export-shorthand.canary.ts',
    ],
    plugins: { unicorn },
    rules: {
      'unicorn/prefer-export-from': ['error', { ignoreUsedVariables: false }],
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
  //     public-readable artifacts. As of Phase-3 Commit 5 the canonical
  //     implementation lives at
  //     `src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts`;
  //     `src/Common/SafeScreenshot.ts` is now a deprecated re-export
  //     shim. Both files remain allow-listed so the helper itself can
  //     call `page.screenshot()` without tripping the rule.
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/Common/SafeScreenshot.ts',
      'src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts',
      'src/Tests/**',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES, NO_DIRECT_SCREENSHOT_RULE],
    },
  },

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
  //     intentionally malformed; excluded via `ignores`.
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/Scrapers/Pipeline/EslintCanaries/**'],
    rules: {
      'no-warning-comments': [
        'error',
        {
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
        },
      ],
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
  // Per-function cap stays at **20** effective lines for the broad
  // Mediator/Scrape/** surface — this matches the original Phase 5
  // baseline and avoids forcing pre-existing files unrelated to
  // Phase 8.5b's canonical-10 drain (AccountExtractor, BfsFieldSearch,
  // Coercion, ContainerPicker, EndpointResolver, ForensicAuditAction,
  // JsonTraversal, MirrorDetection, ScrapeUiTrigger, TxnMapper,
  // TxnShape, LifoCrawl, TxnHunt) into a phase-mismatched refactor.
  // §12B below raises the bar to **10** for the drained canonical-10
  // sub-folders (ScrapePhase/**, ScrapeReplay/**, FrozenScrapeAction,
  // UrlDateRange). Pre-existing files retain cap 20 here until their
  // own dedicated drain phase.
  //
  // File-size cap stays at **150 effective lines** so every Scrape
  // sub-module still fits in a single reviewer's working memory.
  //
  // The shim itself (`ScrapeAutoMapper.ts`) is intentionally left
  // unconstrained — Section 7 already allows it, and this guard is
  // about preventing regression of the new homes, not the facade.
  //
  // Two canary files enforce both halves of the cap: the
  // `no-scrape-mapper-blob.canary.ts` over-sizes the file to prove
  // `max-lines` fires, and the
  // `scrape-cluster-fn-over-cap.canary.ts` over-sizes a single
  // function to prove `max-lines-per-function` fires.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-scrape-mapper-blob.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-cluster-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 20, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
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
  // the banned name so verify.sh asserts the rule fires on every commit.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhase/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/FrozenScrapeAction.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/UrlDateRange.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-canonical10-lookup-array-shouldbe-set.canary.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'VariableDeclarator[id.name=/^lower\\w*Keys$/]',
          message:
            'PR #281 C8 §12C: name `lower*Keys` implies a key set for membership testing (Sonar S7776). Use `new Set(keys.map(k => k.toLowerCase()))` named `lower*KeySet`, or rename to `lowerNames` if iterating only.',
        },
      ],
    },
  },

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
  //     sentinel-literal ban fires
  {
    files: [
      'src/Scrapers/Pipeline/Types/PiiRedactor/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-pii-redactor-blob.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/pii-cluster-fn-over-cap.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/pii-facade-no-grandfather.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/lint-guideline-coverage-defaults-audit.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/pii-hardcoded-sentinel.canary.ts',
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
      'no-restricted-syntax': [
        'error',
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
      ],
    },
  },

  // 13B. PII CONSTANT DEFINER UNLOCK
  //
  // `Types.ts` legitimately HOLDS the hint constants — its
  // `export const REDACTED_HINT = '[REDACTED]'` declaration MUST
  // contain the bare literal. Unlock the §13 sentinel ban here.
  {
    files: ['src/Scrapers/Pipeline/Types/PiiRedactor/Types.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // 13C. PII ERROR-LOG NO-BYPASS LOCK
  //
  // `ErrorLog.ts` MUST NEVER reference `isPiiRedactionDisabled` —
  // bank error messages are security-classified (CodeQL #28 / CR
  // cycle-1 #3): they always redact, even with `PII_REDACTION=off`.
  // The same lock applies to the canary that proves the rule fires.
  {
    files: [
      'src/Scrapers/Pipeline/Types/PiiRedactor/ErrorLog.ts',
      'src/Scrapers/Pipeline/EslintCanaries/pii-errorlog-bypass.canary.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Identifier[name='isPiiRedactionDisabled']",
          message:
            '🚫 SECURITY (CodeQL #28 / CR cycle-1 #3): ErrorLog.ts MUST always-redact. ' +
            'Do not reference isPiiRedactionDisabled here — bank error messages are ' +
            'security-classified and cannot be bypassed via PII_REDACTION=off.',
        },
      ],
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
  // The legacy `IApiDirectCallConfig.ts` shim itself is intentionally
  // left unconstrained — Section 7 already allows it, and this guard
  // is about preventing regression of the new homes, not the
  // tombstone re-export.
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

  // 19.4 ACTIVATION — Pipeline/Mediator/{Elements,Form} now enforced
  // at canonical 10/10 (was grandfathered at 20/12). Phase-2a-B
  // refactors (C6-C11) drove these clusters down. Files with
  // surviving over-10 helpers are exempted in §19.4a.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Elements/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Form/**/*.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 10],
    },
  },

  // 19.4a PER-FILE EXCEPTION — specific files retain grandfather at
  // 20/12 for browser-context helpers that resist further extraction
  // (page.evaluate serialised closures where extraction would break
  // the boundary). Tracked separately as v8.5.0 CR-deferred items:
  //   - Elements/ActionExecutors.ts → snapshotClickedInBrowser (16 LoC)
  //   - Elements/CreateElementMediator.ts → snapshotIdentityInBrowser (14 LoC)
  //   - Form/FormAnchor.ts → mapAncestorTuples (20 LoC)
  //   - Form/FormErrorDiscovery.ts → scanDomErrorsInBrowser (16 LoC)
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Elements/ActionExecutors.ts',
      'src/Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.ts',
      'src/Scrapers/Pipeline/Mediator/Form/FormAnchor.ts',
      'src/Scrapers/Pipeline/Mediator/Form/FormErrorDiscovery.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
      'max-statements': ['error', 12],
    },
  },

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
  // `.skip` remains, blocking the merge).
  {
    files: [
      'src/Tests/E2eMocked/Amex.e2e-mocked.test.ts',
      'src/Tests/E2eMocked/Isracard.e2e-mocked.test.ts',
      'src/Tests/E2eMocked/ErrorScenarios.e2e-mocked.test.ts',
      'src/Tests/E2eMocked/ExternalBrowser.e2e-mocked.test.ts',
      'src/Tests/E2eMocked/Discount/Discount.e2e-mocked.test.ts',
      'src/Tests/E2eMocked/Max/Max.e2e-mocked.test.ts',
      'src/Tests/E2eMocked/VisaCal/VisaCal.e2e-mocked.test.ts',
    ],
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
  // The §19.9 rule (defined inline in §4 + §5) bans
  // FunctionDeclaration bodies > 10 stmts inside `src/Tests/**`.
  // This canary-only block re-enables the rule on a single fixture
  // under `EslintCanaries/` (globally ignored at line 539) so
  // `verify.sh` can confirm the guardrail stays armed.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/test-helper-over-10-stmts.canary.ts'],
    rules: {
      'no-restricted-syntax': ['error', TEST_HELPER_OVER_10_STMTS_RULE],
    },
  },

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

  // 19.11 NO-MAGIC-NUMBERS — Pipeline/Mediator/**. Phase 2 close-out
  // T3. The C12 commit drained all 73 magic-number sites across 36
  // Mediator/ files: shared HTTP statuses + URL-log tail moved to
  // `Network/FetchConfig.ts`; one-off literals (ports, ms delays,
  // slice tails, parse radixes, slot widths) became named per-file
  // `const`s. From now on every new literal in `Mediator/**` must
  // either resolve to an existing named constant or introduce its own
  // — keeps numerology out of business logic and lets `--fix` /
  // grep / IDE rename retain semantic context.
  //
  // Allowed bare literals: 0, 1, -1 (boundary conditions); array
  // indexes (semantically self-describing).
  {
    files: ['src/Scrapers/Pipeline/Mediator/**/*.ts'],
    rules: {
      'no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          enforceConst: true,
        },
      ],
    },
  },

  // 19.11 CANARY — re-enable `no-magic-numbers` on a single fixture
  // under `EslintCanaries/` so `verify.sh` can confirm the guardrail
  // stays armed.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/no-magic-numbers-in-mediator.canary.ts'],
    rules: {
      'no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          enforceConst: true,
        },
      ],
    },
  },
);
