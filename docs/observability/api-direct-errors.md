# API-direct error diagnosis

When an api-direct bank (OneZero / Pepper / PayBox) returns an error response, the pipeline used to fail with only an opaque `envelope selector miss: <name> at <path>` message. Diagnosing the cause required re-running the test with `PII_REDACTION=off` to see what the bank actually said.

Since the [api-direct envelope sniff](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/GenericEnvelopeParser.ts) landed, the parser surfaces the bank's reported error directly inside the failure message — no re-run required.

## What you see now

When the configured success-envelope JSON pointer (e.g. `/content/access_token`) does not resolve, the parser inspects the response document for the four well-known error fields and appends them to the failure message:

```
envelope selector miss: accessToken2 at /content/access_token
  [bank-error: code=42 name=INVALID_PIN message=Invalid PIN
   explanation=The supplied PIN does not match the stored credential.]
```

The bracketed `[bank-error: ...]` suffix is added only when at least one of `code`, `name`, `message`, or `explanation` is present and well-formed in the response.

## How to read the suffix

| Field             | Meaning                                         | Typical content                                      |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------- |
| `code=N`          | Bank's machine-readable error code              | Numeric (`42`) or short enum string (`RATE_LIMITED`) |
| `name=NAME`       | Bank's error name                               | `INVALID_PIN`, `EXPIRED_TOKEN`, `RATE_LIMITED`       |
| `message=...`     | Short human-readable error message              | One short sentence                                   |
| `explanation=...` | Extended description, when the bank provides it | One sentence or short paragraph                      |

## PII contract

Bank error envelopes carry only stable error enums plus generic descriptions; they do **not** echo customer credentials. The sniff therefore writes the fields verbatim into `errorMessage` without routing them through `PiiRedactor`. Per-field length caps keep the surface bounded:

| Field         | Maximum length |
| ------------- | -------------- |
| `code`        | 32 characters  |
| `name`        | 64 characters  |
| `message`     | 200 characters |
| `explanation` | 200 characters |

This contract was verified across PayBox, Pepper, and OneZero. If a future bank starts echoing customer text in any of those four fields, the contract changes and the parser would need to add a redactor pass — open an issue.

## When the suffix is absent

The parser emits the bare `envelope selector miss: <name> at <path>` message (no suffix) when:

- the response document is not an object (`null`, array, primitive)
- none of `code`, `name`, `message`, `explanation` are present
- a field is present but the wrong type (e.g. `code` is a nested object) — the parser ignores type-mismatched hints rather than emitting noise

## Where in the code

| What                         | Path                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parser + sniff helpers       | [GenericEnvelopeParser.ts](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/GenericEnvelopeParser.ts)             |
| `bankErrorHints` (the sniff) | Same file                                                                                                                                                                                  |
| Tests                        | [GenericEnvelopeParser.test.ts](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Tests/Unit/Pipeline/Mediator/ApiDirectCall/Envelope/GenericEnvelopeParser.test.ts) |

## Operator playbook

When you see `envelope selector miss` in CI or local logs:

1. **Read the suffix.** `[bank-error: code=X name=Y]` tells you the bank's category of failure.
2. **Decide from there.** Common cases:
   - `INVALID_PIN` / `INVALID_PASSWORD` → refresh credentials in `.env`
   - `RATE_LIMITED` / `TOO_MANY_REQUESTS` → wait + retry; do not loop
   - `EXPIRED_TOKEN` / `EXPIRED_SESSION` → reset persistent OTP token; re-run cold path
   - Unknown name → open an issue with the failure line; the maintainers will add a recipe
3. **If no suffix appears**, the response was not an error envelope shape we recognise. Capture the raw response (re-run with `PII_REDACTION=off` only after confirming no real credentials are in the .env) and attach to your bug report.
