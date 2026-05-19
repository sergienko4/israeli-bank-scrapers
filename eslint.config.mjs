// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import jsdoc from 'eslint-plugin-jsdoc';
import regexpPlugin from 'eslint-plugin-regexp';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import jestPlugin from 'eslint-plugin-jest';

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

  // T17: Pseudorandom number generator safety (SonarCloud S2245 /
  // typescript:S2245). `Math.random()` is a PRNG, not a CSPRNG —
  // attackers can predict its output. The project blocks all uses
  // and only allows `node:crypto.randomBytes()`, `randomInt()`,
  // `randomUUID()`. Reference:
  // https://docs.sonarsource.com/sonarcloud/javascript/rules/S2245
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      "🚫 SECURITY (S2245): Math.random() is forbidden. Use node:crypto's randomBytes(), randomInt(), or randomUUID() — see SECURITY.md / cycle-3 humanize commit.",
  },
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
  // Mirror of the legacy-rules T17 — Math.random() forbidden everywhere
  // in the Pipeline scope too. See RESTRICTED_SYNTAX_RULES.T17 comment.
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message:
      "🚫 SECURITY (S2245): Math.random() is forbidden. Use node:crypto's randomBytes(), randomInt(), or randomUUID().",
  },

  // T18: Detached `child_process.spawn(..., { detached: true })` MUST
  // be followed by `.unref()` so the parent process can exit without
  // waiting on the detached child's stdio handle. Without `.unref()`,
  // Jest hangs at the end of the test run and only `--forceExit` masks
  // it. Locks CodeRabbit F9 on PR #235 (CamoufoxJsMock virtual-display
  // spawn). Pipeline-only — production code outside the Pipeline does
  // not spawn detached children.
  {
    selector:
      "CallExpression[callee.name='spawn'][arguments.2.type='ObjectExpression'] > ObjectExpression > Property[key.name='detached'][value.value=true]",
    message:
      "🚫 RESOURCE LEAK (T18): spawn({ detached: true }) without proc.unref() blocks parent exit. Add `proc.unref()` immediately after the spawn call. See CodeRabbit F9.",
  },

  // T19 (path-traversal heuristic) was attempted as a global ESLint
  // rule but was dropped — see RESTRICTED_SYNTAX_RULES head-comment.
  // The F8 path-traversal guard lives in CamoufoxLauncher.getProfileDir
  // (`path.basename` wrap + closed-enum bank check) and is verified by
  // unit tests asserting `''` / `.` / `..` rejection.
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
    plugins: {
      jest: jestPlugin,
    },
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

      // SonarCloud-parity jest rules — catch S2699-class issues
      // ("test with no assertion") at lint time, before Sonar sees them.
      // Two explicit rules cover the SonarCloud surface (S2699 +
      // malformed-expect detection). `jest/no-conditional-expect` is
      // intentionally omitted because the codebase relies on
      // conditional `expect(...)` in variant-detection tests
      // (~680 sites in 2026-05); enabling it requires a separate
      // architectural refactor and is not part of this PR's scope.
      //
      // `assertFunctionNames` whitelists the project's helper-assertion
      // pattern. Cross-bank factory tests delegate assertions to small
      // helpers that internally call `expect(...)` — `jest/expect-expect`
      // cannot trace across function boundaries so it would false-positive
      // on every factory test (~60 sites) without this whitelist. Patterns
      // track the actual helper-naming conventions used under
      // `src/Tests/Unit/`:
      //   - `assert*Shape` / `assert*Run`   — direct assertion helpers.
      //   - `**.assert*`                    — namespaced (e.g. INTEGRATION.assertFailure).
      //   - `run*ForRow`                    — Phase H per-row factory drivers.
      //   - `runSkipScenario`               — OtpPollerTelegram one-off.
      'jest/expect-expect': [
        'error',
        {
          assertFunctionNames: ['expect', 'assert*', '**.assert*', 'run*ForRow', 'runSkipScenario'],
        },
      ],
      'jest/valid-expect': 'error',

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
      // This applies to ALL files in Pipeline, including Mediator and Strategy
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES_NEW],

      // --- C. DEFAULT COMPLEXITY (STRICT) ---
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 15 }],
      'max-depth': ['error', 1],
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
      // typescript-eslint — type-aware Sonar parity
      '@typescript-eslint/prefer-readonly': 'error', // S2933
      // Unicorn — modern-JS rules SonarCloud wraps
      'unicorn/prefer-export-from': 'error', // S7763 (strict — `ignoreUsedVariables` dropped 2026-05-18)
      'unicorn/prefer-node-protocol': 'error', // S7772
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

  // 12. ARCHITECTURE-RULE EXCEPTION — DELETED 2026-05-18.
  //
  //     This block previously suppressed `sonarjs/redundant-type-aliases`
  //     on 8 production files containing `type X = unknown;` and
  //     `type ContextId = string;` aliases that dodged other
  //     architecture rules (`no-restricted-syntax` bare-unknown ban +
  //     legacy Rule #15 no-primitive-returns). Phase C closed all 8
  //     in code: 6 `= unknown` aliases were replaced with the shared
  //     `JsonValue` recursive-union type (C.5.T2); `ContextId` was
  //     branded via `Brand<string, 'ContextId'>` + `mintContextId`
  //     helper (C.5.T3, this commit). The architectural canary
  //     `EslintCanaries/redundant-type-alias.canary.ts` locks the
  //     rule in place so this anti-pattern cannot regress.
  //
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
);
