# PII redaction

`PiiRedactor.ts` is the single source of truth. Pino runs it as the `redact.censor` callback so every record is redacted _before_ any transport writes.

| Source | [`src/Scrapers/Pipeline/Types/PiiRedactor.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/PiiRedactor.ts) |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |

## What gets redacted vs what survives

| Category                            | Example before → after                         | Why we keep the survivor                                           |
| ----------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| Account / card / Israeli ID / phone | `12-170-[REDACTED-DIGITS-6]` → `***6789`       | Last-4 lets us correlate across phases without showing the full id |
| Cardholder / customer name          | `דני משהו` → `<name:8>` (length tag)           | Length distinguishes spoof attempts                                |
| Merchant description                | `סופר-פארם רמת גן` → `<merchant:14>`           | Length helps reproduce the bug shape                               |
| Transaction amount                  | `-247.50` → `-***`                             | Sign preserved for credit/debit distinction                        |
| Auth tokens / cookies / OTP codes   | `eyJhbGc...`, `123456` → `[REDACTED]`, `[OTP]` | Discriminates token-shaped from non-token strings                  |
| URLs                                | host + path preserved; PII query keys redacted | Lets us correlate to the bank endpoint without leaking ids         |
| HTML response text                  | text nodes + `value` attributes scrubbed       | Captured response structure remains useful for debugging           |
| Anything unrecognized               | `[REDACTED]` (default-deny)                    | Fail closed when in doubt                                          |

## The censor function

`PiiRedactor.censor(record)` walks the entire object graph and applies category-aware substitutions:

```typescript
const redacted = PII_REDACTOR.censor({
  event: 'balance-resolve.fetch.success',
  bankAccountUniqueId: '12345678', // → '***5678'
  authorization: 'Bearer eyJhbGc...', // → '[REDACTED]'
  amount: -247.5, // → '-***'
  message: 'fetched OK', // unchanged — no PII shape
});
```

## Where redaction runs

| Sink                             | Redacted by                          | Format on disk |
| -------------------------------- | ------------------------------------ | -------------- |
| `pipeline.log` (Pino)            | `redact.censor` callback at log time | JSON lines     |
| `network/*.json` (HTTP captures) | `PiiRedactor` pre-write filter       | JSON           |

Browser screenshot and DOM-snapshot capture were removed. HTML redaction
remains useful for text returned by HTTP endpoints; it does not run a DOM
interaction flow.

#### Forensic capture (`FORENSIC_TRACE`) — opt-in only

| `FORENSIC_TRACE`                   | Effect                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unset / `false` / any other value  | `getRunFolder` returns `''`. No run folder, file log or HTTP dumps. **Default.**                                                                        |
| `true` (trimmed, case-insensitive) | Writes `pipeline.log` and `network/*.json` in the run folder under `RUNS_ROOT`. Failed CI runs route the bundle to the access-controlled private store. |

`FORENSIC_TRACE` is decoupled from `LOG_LEVEL` (pino verbosity only) and `CI`
(OTP / Telegram). Set it explicitly when triaging a failure:

```sh
FORENSIC_TRACE=true npm run test:e2e:real
```

## JSON parse failures

V8's `SyntaxError` for `JSON.parse` can quote the rejected input: the whole text when it is short, otherwise a 10-character prefix (`"card=45801"... is not valid JSON`). Position-only messages quote nothing. The parse carriers that would pass that message into failure text or a log line go through [`Types/JsonParseFailure.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/JsonParseFailure.ts) instead:

| Symbol                             | Behaviour                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `describeJsonParseFailure(caught)` | Returns a `JsonParseFailureText` of `invalid JSON (SyntaxError)`, or `invalid JSON (SyntaxError at position N)`. Other errors pass through as their message. It matches on `error.name`, so errors from another realm are covered. |
| `parseJsonOrThrow(text, context)`  | Parses, or throws `ScraperError("<context>: <reason>")` with no `cause`, so the original excerpt is not chained.                                                                                                                   |
| `parseCapturedTemplate(postData)`  | `parseJsonOrThrow` for a captured POST template. A form-encoded body fails without echoing its fields.                                                                                                                             |

The position is read only from V8's trailing `JSON at position N` suffix, so digits inside a quoted body are never mistaken for it.

## Disabling redaction

`PII_REDACTION=off` disables runtime redaction. **Intended for real-bank E2E tests only** (where the maintainer needs to compare actual vs expected values during development). Unit tests always run with redaction default-on so `PiiRedactor.test.ts` assertions hold.

```sh
# In .env at repo root, for real-bank E2E runs ONLY:
PII_REDACTION=off
```

Never set this in production code or CI.

## Commit-time enforcement (PII-Log canary)

ESLint AST selectors reject pull requests that try to bypass the runtime layer. Banned patterns:

- `LOG.<level>(\`...${piiIdentifier}...\`)` — direct PII interpolation into template literals
- `LOG.<level>({ result, ... })` / `{ accounts }` / `{ transactions }` — passing whole payloads
- `console.log` (any) — bypasses Pino entirely

Source: the [`pii-template-literal`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/EslintCanaries/pii-template-literal.canary.ts), [`pii-error-message`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/EslintCanaries/pii-error-message.canary.ts), and [`pii-payload-key`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/EslintCanaries/pii-payload-key.canary.ts) canary fixtures + the `PII-Log` rule in `lint-and-validate.ts`.

If your new code emits a log that triggers the canary at commit time, the right fix is to extract the safe identifier first:

```typescript
// ❌ banned
LOG.info(`fetched for account ${accountId}`);

// ✅ allowed
const masked = maskTail4(accountId);
LOG.info({ event: 'fetch.complete', account: masked });
```
