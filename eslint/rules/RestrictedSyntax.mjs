// @ts-check
/**
 * The two `no-restricted-syntax` selector sets: the repo-wide legacy set
 * and the stricter Pipeline contract set.
 */
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
    // Phase 7: per-bank `describe('<Phase>.<bank>')` duplication anti-pattern.
    // Matches a literal of shape `<Word>.<bank>` where <bank> is one of the 17
    // CompanyTypes enum values (exact casing — most are lowercase but `visaCal`,
    // `oneZero`, `otsarHahayal`, `payBox` are camelCase per
    // `src/Definitions.ts`). Forces consolidation via `it.each(BANKS)` (from
    // `src/Tests/Helpers/banks.ts`). Does NOT block bank-as-feature-name
    // describes (e.g. `describe('Hapoalim WAF challenge')`) because they start
    // with the bank name itself, not `<Phase>.<bank>`.
    selector:
      "CallExpression[callee.name='describe'] > Literal[value=/^[A-Z][A-Za-z0-9]*\\.(hapoalim|discount|max|visaCal|isracard|amex|beinleumi|oneZero|pepper|mizrahi|mercantile|otsarHahayal|yahav|leumi|massad|pagi|payBox)$/]",
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
      'NewExpression[callee.name=/^(?!Error|Map|Set|Date|RegExp|URL|Headers|EventEmitter|ScraperError|PipelineBuilder|DashboardPhase|ScrapePhase|OtpPhase|TerminatePhase)[A-Z]/]',
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

export {
  RESTRICTED_SYNTAX_RULES,
  RESTRICTED_SYNTAX_RULES_NEW,
};
