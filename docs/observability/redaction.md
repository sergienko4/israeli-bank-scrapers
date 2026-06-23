# PII redaction

`PiiRedactor.ts` is the single source of truth. Pino runs it as the `redact.censor` callback so every record is redacted *before* any transport writes.

| Source | [`src/Scrapers/Pipeline/Types/PiiRedactor.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/PiiRedactor.ts) |
|---|---|

## What gets redacted vs what survives

| Category | Example before → after | Why we keep the survivor |
|---|---|---|
| Account / card / Israeli ID / phone | `12-170-[REDACTED-DIGITS-6]` → `***6789` | Last-4 lets us correlate across phases without showing the full id |
| Cardholder / customer name | `דני משהו` → `<name:8>` (length tag) | Length distinguishes spoof attempts |
| Merchant description | `סופר-פארם רמת גן` → `<merchant:14>` | Length helps reproduce the bug shape |
| Transaction amount | `-247.50` → `-***` | Sign preserved for credit/debit distinction |
| Auth tokens / cookies / OTP codes | `eyJhbGc...`, `123456` → `[REDACTED]`, `[OTP]` | Discriminates token-shaped from non-token strings |
| URLs | host + path preserved; PII query keys redacted | Lets us correlate to the bank endpoint without leaking ids |
| HTML snapshots | text nodes + `value` attributes scrubbed in place | Layout preserved for debugging |
| Anything unrecognized | `[REDACTED]` (default-deny) | Fail closed when in doubt |

## The censor function

`PiiRedactor.censor(record)` walks the entire object graph and applies category-aware substitutions:

```typescript
const redacted = PII_REDACTOR.censor({
  event: 'balance-resolve.fetch.success',
  bankAccountUniqueId: '12345678',   // → '***5678'
  authorization: 'Bearer eyJhbGc...', // → '[REDACTED]'
  amount: -247.50,                    // → '-***'
  message: 'fetched OK',              // unchanged — no PII shape
});
```

## Where redaction runs

| Sink | Redacted by | Format on disk |
|---|---|---|
| `pipeline.log` (Pino) | `redact.censor` callback at log time | JSON lines |
| `network/*.json` (NetworkDiscovery captures) | `PiiRedactor` pre-write filter | JSON |
| `screenshots/*.png` (SafeScreenshot) | **NOT redacted** — raster | PNG |
| `*.html` snapshots (FixtureCapture, opt-in `DUMP_FIXTURES_DIR`) | `redactHtml` text + `value` attribute scrubs | HTML |

### `safeScreenshot` API

The canonical capture function is `safeScreenshot(page, options)` in
`src/Scrapers/Pipeline/Mediator/Browser/SafeScreenshot.ts`. It accepts an
`IScreenshotOptions` (`path` + optional `fullPage`), writes the raw PNG to
that path, and swallows any capture error so a failed shot stays
diagnostic-only. It performs **no** redaction — PNGs are raster and cannot be
reliably scrubbed (see the table above). It does **not** write HTML; DOM
snapshots are a separate channel owned by `FixtureCapture` / `SnapshotInterceptor`.

Capture is gated **upstream**, not inside `safeScreenshot`. The target path
comes from `TraceConfig.getScreenshotDir`, which is empty unless the opt-in
`FORENSIC_TRACE=true` flag is set (`TraceConfig.getRunFolder`). With forensic
capture off — the default — `BasePhase.takePhaseScreenshot` receives an empty
path and returns early, so **no PNG is ever written**. There is no per-phase or
CI allowlist: the single `FORENSIC_TRACE` switch governs the whole run folder
(`pipeline.log`, `network/*.json`, `screenshots/*.png`) together.

`safeScreenshot` does not decide whether output is public or private and does
not divert files into a `private/` directory. The public CI artifact path block
is the routing control: it uploads only `pipeline.log` and `network/*.json`.
On failure, `upload-private-diagnostics.sh` uploads the full forensic run
folder, including screenshots, to the access-controlled OCI diagnostics store.
If screenshot capture itself fails, only a path-scrubbed reason is logged;
absolute paths and leading relative path tokens are replaced before logging.

#### Forensic capture (`FORENSIC_TRACE`) — opt-in only

| `FORENSIC_TRACE` | Effect |
|---|---|
| unset / `false` / any other value | `getRunFolder` returns `''`. No run folder, no `pipeline.log`, no `network/*.json`, no screenshots. **Default.** |
| `true` (trimmed, case-insensitive) | The pipeline writes the full run folder under `RUNS_ROOT`. On a failed CI job the whole bundle (`pipeline.log`, `network/*.json`, `screenshots/*.png`) uploads to the access-controlled private store only — never to a public GitHub artifact (raster pixels can carry rendered PII). |

`FORENSIC_TRACE` is decoupled from `LOG_LEVEL` (pino verbosity only) and `CI`
(OTP / Telegram). Set it explicitly when triaging a failure:

```sh
FORENSIC_TRACE=true npm run test:e2e:real
```

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
