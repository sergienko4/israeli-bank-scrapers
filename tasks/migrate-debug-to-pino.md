# Task: Migrate from debug to Pino with Built-in Redaction

## Status: In Progress

## Priority: High

## Estimated effort: 4-6h

## Current State

The project uses the `debug` package for logging via `getDebug()` in `src/Helpers/Debug.ts`.
19 production files and ~20 test files reference it. There is **no redaction** — credentials,
tokens, account numbers, and amounts are logged in plaintext. The existing ESLint rule
(`no-restricted-syntax`) only catches `logger.info({password})` patterns — it misses
`DEBUG(credentials)` calls entirely.

Real CI logs currently expose:

```
--- Account 0152228812 | balance: 15242.97 | 9 txns ---
  4.2.2026      11000.00 ILS  בנק לאומי משכורת
  14.2.2026        10.00 ILS  העברה מיוגין סרגיאנקו חשבון ב.
```

## Target

Replace `debug` with `pino` — a production-grade logger with built-in redaction
(powered by `fast-redact`). Configure path-based redaction with a custom censor function:

- **Credentials**: `password`, `token`, `secret`, `otp`, `authorization`, `id`, `card6Digits` → `[REDACTED]`
- **Account numbers**: `accountNumber` → show last 4 (`****8812`)
- **Amounts**: `balance`, `originalAmount`, `chargedAmount` → show sign only (`-***`)

After:

```
--- Account ****8812 | balance: -*** | 9 txns ---
  4.2.2026        +*** ILS  בנק לאומי משכורת
  14.2.2026       +*** ILS  העברה מיוגין סרגיאנקו חשבון ב.
```

## Planned Work

### 1. Install pino + pino-pretty

```
npm install pino
npm install -D pino-pretty
```

- `pino` v10.x — structured JSON logger with built-in redaction
- `pino-pretty` — human-readable output for local dev (when `DEBUG` env or `NODE_ENV=development`)

### 2. Rewrite `src/Helpers/Debug.ts`

Replace the 5-line `getDebug` wrapper with a pino-based logger factory:

```typescript
import pino from 'pino';

const REDACT_PATHS = [
  'password',
  'credentials.password',
  'token',
  'auth.token',
  'auth.calConnectToken',
  'secret',
  'otp',
  'otpCode',
  'id',
  'credentials.id',
  'card6Digits',
  'credentials.card6Digits',
  'credentials.num',
  'authorization',
  'accounts[*].accountNumber',
  'accounts[*].balance',
  'accounts[*].txns[*].originalAmount',
  'accounts[*].txns[*].chargedAmount',
];

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'debug',
  redact: {
    paths: REDACT_PATHS,
    censor: (value: unknown, path: string[]) => {
      const key = path[path.length - 1];
      if (key === 'accountNumber') return '****' + String(value).slice(-4);
      if (['balance', 'originalAmount', 'chargedAmount'].includes(key))
        return (value as number) > 0 ? '+***' : '-***';
      return '[REDACTED]';
    },
  },
});

export function getDebug(name: string) {
  return logger.child({ module: name });
}
```

**Key decision**: `getDebug()` returns a pino child logger. Callers switch from
`DEBUG('message', obj)` to `DEBUG.debug(obj, 'message')` or `DEBUG.debug('message')`.

### 3. Update 19 production files

Each file currently does:

```typescript
import { getDebug } from '../Helpers/Debug';
const DEBUG = getDebug('visa-cal');
DEBUG('open login popup');
DEBUG('data: %O', someObject);
```

Migrate to:

```typescript
import { getDebug } from '../Helpers/Debug';
const logger = getDebug('visa-cal');
logger.debug('open login popup');
logger.debug(someObject, 'fetched data');
```

Files to update:

- `src/Helpers/Fetch.ts`
- `src/Helpers/OtpDetector.ts`
- `src/Helpers/OtpHandler.ts`
- `src/Helpers/SelectorResolver.ts`
- `src/Scrapers/BaseIsracardAmex.ts`
- `src/Scrapers/BaseIsracardAmexFetch.ts`
- `src/Scrapers/BaseIsracardAmexTransactions.ts`
- `src/Scrapers/BaseScraperHelpers.ts`
- `src/Scrapers/BaseScraperWithBrowser.ts`
- `src/Scrapers/Behatsdaa.ts`
- `src/Scrapers/BeinleumiAccountSelector.ts`
- `src/Scrapers/BeyahadBishvilha.ts`
- `src/Scrapers/Hapoalim.ts`
- `src/Scrapers/Max.ts`
- `src/Scrapers/Mizrahi.ts`
- `src/Scrapers/MizrahiHelpers.ts`
- `src/Scrapers/OneZero.ts`
- `src/Scrapers/VisaCal.ts`
- `src/Scrapers/VisaCalHelpers.ts`

### 4. Update ~20 test files

Test files mock `getDebug` via `jest.mock('../Helpers/Debug')`. Update mock to return
a pino-compatible child logger shape:

```typescript
jest.mock('../Helpers/Debug', () => ({
  getDebug: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
```

### 5. Update E2E `logScrapedTransactions`

Revert manual `maskAccount/maskAmount/maskDescription` functions from `src/Tests/E2eReal/Helpers.ts`.
Use pino's redaction for credential/token masking. For the E2E transaction log output,
keep simple account masking (`****` + last 4) since this is `console.log` not pino —
but amounts and descriptions can stay visible (they're not PII).

### 6. Strengthen ESLint security rules

Add to `eslint.config.mjs` `no-restricted-syntax`:

```javascript
{
  selector: "CallExpression[callee.object.name='logger'][callee.property.name='debug'] Identifier[name=/credentials|password|token|secret|otp/i]",
  message: 'SECURITY: Do not log credential variables directly. Pino redaction handles this.',
},
```

### 7. Remove `debug` dependency

```
npm uninstall debug @types/debug
```

Update `package.json` — remove from dependencies.

## Implementation Approach

1. Start with `Debug.ts` rewrite + install pino
2. Update production files in batches (Helpers first, then Scrapers A-M, then N-Z)
3. Update test mocks in parallel
4. Run `npm run build && npm run lint && npm test` after each batch
5. Update E2E helpers last
6. Final: remove `debug` + `@types/debug` from deps

## Acceptance Criteria

- [ ] `debug` and `@types/debug` removed from `package.json`
- [ ] `pino` in dependencies, `pino-pretty` in devDependencies
- [ ] All 19 production files use `getDebug()` returning pino child logger
- [ ] Redaction config covers: password, token, secret, otp, authorization, id, card6Digits, accountNumber, balance, amounts
- [ ] Custom censor: credentials → `[REDACTED]`, accountNumber → `****XXXX`, amounts → `+***`/`-***`
- [ ] ESLint rule blocks `logger.debug(credentials)` patterns
- [ ] E2E logs show masked account numbers in CI
- [ ] All 515+ tests pass
- [ ] ESLint, TypeScript, Prettier clean
- [ ] `npm run build` succeeds (tsup + publint)
