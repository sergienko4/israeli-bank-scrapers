// Canary: T09 — PII identifier in LOG.* template literal
// MUST trigger ≥1 ESLint error (PII LEAK T09 selector). PiiRedactor is the
// single source of truth for redaction; embedding raw PII into a template
// literal bypasses Pino path-redaction.

const LOG = { debug: (msg: string): string => msg, info: (msg: string): string => msg };
const accountId = '12-170-123456';
const customerName = 'דני סרגיינקו';
const otpLongTermToken = 'eyJhbGciOiJIUzI1NiIs...';

// 🚫 PII LEAK (T09): account identifier in template literal
LOG.debug(`account: ${accountId}`);

// 🚫 PII LEAK (T09): customer name in template literal
LOG.info(`name: ${customerName}`);

// 🚫 PII LEAK (T09): long-term auth token in template literal
LOG.debug(`tok: ${otpLongTermToken}`);

export { accountId, customerName, otpLongTermToken };
