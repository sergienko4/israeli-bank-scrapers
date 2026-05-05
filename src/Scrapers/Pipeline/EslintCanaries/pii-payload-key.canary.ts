// Canary: T16 — full-object payload passed to LOG.*
// MUST trigger ≥1 ESLint error (PII LEAK T16 selectors). Banned shapes:
//   T16a: forbidden bucket key with object/array/spread RHS.
//   T16b: any value-Identifier whose name is a known payload variable.

const LOG = {
  debug: (payload: object): object => payload,
  info: (payload: object): object => payload,
};
const scrapeOutput = { accounts: [{ accountNumber: '12345', txns: [] }] };
const rawArr = [{ a: 1 }, { a: 2 }];
const rawTxns = [{ amount: 100 }];

// 🚫 PII LEAK (T16a): ObjectExpression as 'result' value
LOG.info({ result: { foo: 1 } });

// 🚫 PII LEAK (T16a): ArrayExpression as 'accounts' value (spread)
LOG.info({ accounts: [...rawArr] });

// 🚫 PII LEAK (T16b): payload-named Identifier 'scrapeOutput' under 'result'
LOG.info({ result: scrapeOutput });

// 🚫 PII LEAK (T16b): payload-named Identifier 'rawTxns' under 'transactions'
LOG.debug({ transactions: rawTxns });

export { scrapeOutput, rawArr, rawTxns };
