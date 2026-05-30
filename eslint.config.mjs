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
  selector:
    'CallExpression[callee.type="MemberExpression"][callee.property.name="screenshot"]',
  message:
    'page.screenshot(...) — use safeScreenshot() from src/Common/SafeScreenshot.ts (PII-safe CI gate).',
};

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

      //🚨 Prevent the 'as never' / 'as any' bypass in mocks
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES],
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
            "🚫 PIPELINE TYPE: Type literal sets via a string-literal union (e.g. ReadonlySet<PhaseName>) + `as const`, not ReadonlySet<string>. Catches typos at compile time.",
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
            "🚫 PROCEDURE: Use `isOk(result)` instead of `result.success === true/false`. Keeps narrowing + call-site consistency aligned across the codebase.",
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
  {
    files: ['src/Scrapers/Pipeline/Types/Domain/**/*.ts'],
    rules: {
      'import-x/prefer-default-export': 'off',
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
              group: [
                '**/Strategy/Scrape/**',
                '**/Mediator/Scrape/ScrapePhaseActions*',
              ],
              message:
                '🚫 V5 ISOLATION (T49): BALANCE-RESOLVE must not import SCRAPE internals. Read ctx.scrape.perAccountResponses instead.',
            },
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
              group: [
                '**/Registry/WK/BalanceResolveWK*',
                '**/Mediator/BalanceResolve/**',
              ],
              message:
                '🚫 V5 ISOLATION (T50): SCRAPE must not reference BalanceResolve internals. Balance resolution is owned by the BALANCE-RESOLVE phase.',
            },
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
    files: [
      'src/Scrapers/Pipeline/EslintCanaries/balance-fetch-only-in-balance-resolve.canary.ts',
    ],
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
          selector:
            "AwaitExpression > CallExpression[callee.property.name=/^fetch(Post|Get)$/]",
          message:
            "🚫 BALANCE-RESOLVE QUARANTINE (CR #264 Critical): wrap `await api.fetch*` in safeIssueOneFetch (try/catch) so a thrown fetch cannot abort the Promise.all loop and break per-bank-account quarantine.",
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
          selector:
            "LogicalExpression[operator='??'][left.property.name='balance'][right.value=0]",
          message:
            "🚫 BALANCE DEFAULT-DENY (CR #264 Major): `acc.balance ?? 0` collapses unknown into a real zero. Skip the entry (or surface a typed failure) instead.",
        },
        {
          selector:
            "LogicalExpression[operator='??'][left.property.name='balance'][right.raw='null']",
          message:
            "🚫 BALANCE DEFAULT-DENY (CR #264 Major): `acc.balance ?? null` is forbidden for the same reason as `?? 0` — use a typed skip.",
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
      'jest/expect-expect': [
        'error',
        { assertFunctionNames: ['expect', 'assert*', 'run*'] },
      ],
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
    files: ['src/Scrapers/Base/**/*.ts', 'src/Scrapers/Pipeline/Types/**/*.ts'],
    plugins: { unicorn },
    rules: {
      'unicorn/prefer-export-from': ['error', { ignoreUsedVariables: false }],
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
  //     The SafeScreenshot helper (src/Common/SafeScreenshot.ts) is the
  //     only sanctioned call site — it short-circuits in CI to keep
  //     rendered bank pixels out of public-readable artifacts.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/Common/SafeScreenshot.ts', 'src/Tests/**'],
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
  // **150 effective lines per file** and add a **20-line cap per
  // function** (skipBlankLines + skipComments) so every Network/
  // sub-module stays small enough for a single reviewer to hold
  // in working memory.
  //
  // Pre-existing files that already exceed the new cap
  // (`Fetch.ts`, `AuthFailureWatcher.ts`, `AuthDiscovery.ts`) are
  // grandfathered via file-level `eslint-disable` headers and
  // tracked for split in a future Network/ phase.
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
        { max: 20, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 11A. NETWORK SUB-MODULE GRANDFATHER OVERRIDE
  //
  // PR #276 review-fix: three pre-existing Network/ files exceed the
  // new Section 11 caps (Fetch.ts 300 eff LoC, AuthFailureWatcher.ts
  // 246 eff LoC, AuthDiscovery.ts 220 eff LoC). Splitting them is a
  // separate Network/ phase — this override turns the file-size +
  // per-function caps OFF for those three files ONLY so they pass
  // pre-commit while still appearing in the linter inventory.
  //
  // Suppression via file-level `eslint-disable` headers is NOT used
  // because Section 15 (`no-warning-comments`) bans the
  // `eslint-disable` term across src/**.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Network/Fetch.ts',
      'src/Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher.ts',
      'src/Scrapers/Pipeline/Mediator/Network/AuthDiscovery.ts',
    ],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },

  // 12. SCRAPE SUB-MODULE FILE-SIZE + FUNCTION-SIZE GUARD
  //
  // Phase 5 split the 1637-LoC ScrapeAutoMapper.ts blob into eleven
  // focused sub-modules under `Mediator/Scrape/<Bucket>/` (mirror of
  // Phase 4's Network/ split). Section 7 turns `max-lines` off
  // across all `Mediator/**` files; without a re-imposed bound on
  // the Scrape sub-folder, future commits could quietly re-blob one
  // of the new homes back toward four-digit line counts.
  //
  // Same ceilings as §11 (Network cluster) — **150 effective lines
  // per file** + **20-line cap per function** (skipBlankLines +
  // skipComments) so every Scrape sub-module stays small enough
  // for a single reviewer to hold in working memory.
  //
  // Pre-existing files that already exceed the new cap
  // (`ScrapePhaseActions.ts` 469 eff LoC, `ScrapeReplayAction.ts`
  // 324 eff LoC) are grandfathered via §12A below, mirroring the
  // §11A pattern.
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

  // 12A. SCRAPE SUB-MODULE GRANDFATHER OVERRIDE
  //
  // Phase 5 carries forward four pre-existing Scrape/ files whose
  // shape exceeds the new Section 12 caps:
  //   • ScrapePhaseActions.ts (469 eff LoC — file-size)
  //   • ScrapeReplayAction.ts (324 eff LoC — file-size)
  //   • FrozenScrapeAction.ts (`runFrozenScrape` ~39 lines — function-size)
  //   • UrlDateRange.ts (`appendMissingAliases` ~22 lines — function-size)
  // Splitting / refactoring them is a separate Scrape/ phase — this
  // override turns the file-size + per-function caps OFF for those
  // four files ONLY so they pass pre-commit while still appearing
  // in the linter inventory.
  //
  // Suppression via file-level `eslint-disable` headers is NOT
  // used because Section 15 (`no-warning-comments`) bans the
  // `eslint-disable` term across src/**.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapePhaseActions.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplayAction.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/FrozenScrapeAction.ts',
      'src/Scrapers/Pipeline/Mediator/Scrape/UrlDateRange.ts',
    ],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
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
          selector: "Literal[value=/^(\\[[A-Z_]+\\]|[+\\-]?\\*{3,})$/]",
          message:
            "🚫 PII SENTINEL: Hardcoded redaction sentinel detected. Define it once in './Types.js' " +
            "(e.g. AMOUNT_NEGATIVE_HINT, AMOUNT_POSITIVE_HINT) and import the constant. " +
            'CR cycle-2 / CLAUDE.md "Constants from configuration — never hardcode values inline".',
        },
      ],
    },
  },

  // 13A. PII CLUSTER GRANDFATHER OVERRIDE
  //
  // Pre-existing files exceeding the new §13 caps. Splitting them
  // is tracked as a follow-up phase — this override turns the cap
  // OFF for those files ONLY so they pass pre-commit while still
  // appearing in the linter inventory.
  //
  //   • Facade.ts (~162 eff LoC) — hosts the path-tail routing
  //     table + STRING_STRATEGIES dispatch + the CensorFn factory.
  //     A clean Routing.ts / Dispatch.ts extraction is a separate
  //     phase; until then `max-lines` is off here.
  //
  // Suppression via file-level `eslint-disable` headers is NOT
  // used because Section 15 (`no-warning-comments`) bans the
  // `eslint-disable` term across src/**.
  {
    files: ['src/Scrapers/Pipeline/Types/PiiRedactor/Facade.ts'],
    rules: {
      'max-lines': 'off',
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
);
