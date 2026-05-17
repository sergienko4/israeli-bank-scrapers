// Canary: T09 + T09b + T09c — `errorMessage` in logger template literals.
// MUST trigger ≥1 ESLint error per pattern. Closes CodeQL #28 class —
// bank-side errorMessage strings can echo credentials, and Pino's
// central censor only operates on STRUCTURED payload (the object
// argument), not on values interpolated into the `msg` string.
//
// Locked 2026-05-17 alongside `redactErrorMessage` helper in
// PiiRedactor.ts + `formatFailure` wiring in ResultFormatter.ts.

const LOG = { debug: (msg: string): string => msg, info: (msg: string): string => msg };
const bankLog = {
  info: (msg: string): string => msg,
  warn: (msg: string): string => msg,
  error: (msg: string): string => msg,
};
const logger = { info: (msg: string): string => msg };

interface IFakeResult {
  readonly errorMessage: string;
  readonly password: string;
}
const result: IFakeResult = { errorMessage: 'Wrong password ABC123', password: 'secret' };
const errorMessage = 'Login failed: bad credentials';

// 🚫 T09: errorMessage identifier in LOG.* template literal
LOG.debug(`failure: ${errorMessage}`);

// 🚫 T09b: MemberExpression `result.errorMessage` in any logger callee
bankLog.info(`scrape outcome: ${result.errorMessage}`);

// 🚫 T09b: MemberExpression `result.password` in any logger callee
logger.info(`auth: ${result.password}`);

// 🚫 T09c: credential-class identifier in any logger callee (not LOG.*)
bankLog.warn(`failure: ${errorMessage}`);

export { result, errorMessage };
