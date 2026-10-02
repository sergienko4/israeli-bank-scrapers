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

## Transport failure text

A request URL can carry device ids and session values in its query string,
and an account or card number in its path. Pino's censor sees log *records*,
not the text a transport puts in a failure message, so the fetch code keeps
both out itself.

Every fetch path names a URL through `safeUrlForLog`. It keeps the origin and
the path, drops the query, fragment and credentials, and masks each path
segment of 4+ digits (dashes ignored) to its last four, as in
`/accounts/***7890`. The fetch paths are:

- the pipeline strategies (native fetch, Camoufox identity fetch, in-page
  browser fetch and mTLS), in their errors and debug lines;
- the Mediator's in-page and native fetch helpers, in their call, non-200 and
  WAF log lines, their timeout messages and the `doPostFetch.headers` line;
- the storage-frame auth discovery log.

With `PII_REDACTION=off` the path stays unmasked; the query is still dropped.

The URL the transport builds is not the only route a query can take. The
runtime's exception text and the server's response body can quote the request
back: undici's `Failed to parse URL from …` (which quotes a
credential-bearing URL in full), V8's `JSON.parse` quote of the body it
choked on, a Playwright call log, or an error page that echoes `?did=…`.
Before any such text becomes an `errorMessage`, a body snippet or a log line,
`safeErrorText` cleans it against the request URL and returns it branded
`SafeErrorText`:

1. V8's quote of the body becomes `body is not valid JSON`;
2. every echo of the request is cut, longest form first. `requestEchoCutsOf`
   (in `RequestEchoForms`) lists each form as an `IEchoCut`:
   - the request URL quoted whole becomes its origin and masked path;
   - the query tail as written is dropped;
   - each query value with a form of 8+ characters, and the user name and
     password whatever their length, are marked in every form of 3+
     characters: as sent, percent-decoded, or re-encoded with `+` or `%20`
     for a space;
   - each id-shaped path segment, with or without its dashes, becomes its
     mask (`***7890`) wherever it appears: inside a URL, in a relative path
     the server echoes, or alone;
3. only then is any absolute URL still in the text reduced to its origin and
   masked path. A URL match ends only at whitespace, `"`, `<` or `>`, never
   at an apostrophe, which a URL serializer leaves raw in credentials, paths
   and `encodeURIComponent` values;
4. every mark (`ECHO_CUT_MARK`) becomes `<redacted>`, including a mark that a
   URL serializer percent-encoded inside a shortened path.

The cuts come first because a URL match that ends inside a secret splits it:
a space in a decoded value, or an apostrophe in a password, would leave the
rest of the secret behind, and no rule would know it. Replacements go through
a replacer function, so a `$'` or `$&` in a URL stays literal.

`safeFailureText` applies this to whatever a transport caught. It reads the
message through `caughtMessageOf`, which returns a string for any thrown or
rejected value: `null`, a Symbol, an object whose `toString` throws, or an
error whose `message` is not a string. `safeErrorSnippet` cleans an
error body *before* cutting it to `ERROR_BODY_SNIPPET_LEN` (120)
characters. A cut made first could split a secret so no rule knows the half
left behind, and cleaning both lengthens and shortens text, so no margin
counted around a cut stays sound. The whole body is cleaned: this runs only on
failure paths, over a body the transport already holds in memory.

`NativeFetchStrategy` applies the cleaner once more to every failure its
`_invoke` seam returns, so an mTLS agent or a test seam cannot bypass it. The
oracle fixture `UrlEchoFixtures` lists the real echo shapes, and every
transport's tests run each of them.

### Known gaps

These routes are outside that guarantee:

| Route | What it does |
| --- | --- |
| Legacy Mediator `fetchGet` / `fetchPost` / `fetchGraphql` | Throw runtime errors unchanged to the scrapers that call them; only their log URL labels are sanitized |
| Mediator in-page `evaluate` rejections | Propagate the browser's text unchanged |
| WAF bounce (`WafBlockError` blocked URL) | Uses `redactUrlFull`, which masks only known PII query keys |
| URL discovery and network-dump logs | Use `redactUrlFull`, which masks only known PII query keys |
| `logBodyPreview` | Logs a response-body head through `maskVisibleText`, which only trims and truncates; it does not run the request-echo cleaner |
| A decoded URL other than the request's | A URL quoted with a decoded value that contains a space cannot be told apart from prose. Only the request's own cuts reach it, so the Camoufox navigation failure, which is cleaned against the bare origin, does not cover a decoded URL of another request |
| Camoufox launch and dispose failures | Carry no request; their text is logged as is |
| Benign over-redaction | Text that contains the request's raw query string, even a short one such as `?a`, loses it. Text equal to a secret's short form, or to a 3+ character credential, becomes `<redacted>`. The digits of a request path id are masked to `***LAST4` wherever they appear, even inside an unrelated number |

### Failure text in log lines

`errorMessage` is not a censored key, so a log field holding free failure text
would print verbatim. The sites below keep that text out of the log and record
only `redactErrorMessage`'s `<msg:N>` length tag; the failure itself still
flows to the caller unchanged:

| Site | Why the raw text is unsafe |
| --- | --- |
| `RunStep` `firePost FAIL` | the transport's failure text can quote the request |
| `onAuthFlowComplete callback threw` | a caller's error can quote the token payload |
| `parseResponse.catch` | V8's `JSON.parse` message quotes the response body |
| `handleResponse.error` | the parse failure can quote the response body |

These sites read the caught value through `caughtMessageOf`, so a callback or
parser that rejects with `null`, `undefined` or a Symbol is logged as a tag
rather than throwing inside the catch block. Other catch sites that cast the
caught value `as Error` before `toErrorMessage` predate this guarantee and are
outside it.

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
