# Troubleshooting

Failures grouped by the error you actually see. For the error-code table
returned in `result.errorType`, see [Error types](#error-types) below.

## `Could not locate the bindings file`

Camoufox fails to launch because the native `better-sqlite3` module was never
built. camoufox-js uses it for WebGL fingerprint sampling.

The usual cause is installing with `--ignore-scripts`, which skips
better-sqlite3's prebuild download.

```bash
npm rebuild better-sqlite3
```

If that has to compile from source (no prebuild for your platform), install a
toolchain first:

```bash
sudo apt-get install -y python3 make g++   # Debian / Ubuntu
```

## `Cannot read properties of undefined (reading 'url')`

A scrape dies inside `playwright-core` with this `TypeError` and no stack frame
of ours in the trace.

This library listens for uncaught page errors. Playwright forwards every one of
them and reads `pageError.location.url` **without a null check**, but Camoufox
(Firefox) can report an uncaught error carrying no location — so the read
throws. Upstream still ships the unguarded read as of `playwright-core` 1.62.1.

A `postinstall` step adds the missing null guard for you. It is skipped when you
install with `--ignore-scripts`, so apply it by hand:

```bash
node node_modules/@sergienko4/israeli-bank-scrapers/scripts/patch-playwright-core.mjs
```

The script is idempotent and never fails an install — re-running it on an
already-guarded tree is a no-op. Set `SKIP_PLAYWRIGHT_CORE_PATCH=1` to opt out
entirely if you manage `playwright-core` patches yourself.

!!! note "Why a `scripts/` path exists in an installed package"
    Only `lib/**` ships normally. `scripts/patch-playwright-core.mjs` is the
    one deliberate exception in the package `files` allowlist, because the
    `postinstall` hook has to be able to run it from `node_modules`. No other
    repo script is published.

## `WAF_BLOCKED`

Camoufox passes most Cloudflare challenges automatically. When it does not:

| Scenario | Fix |
| --- | --- |
| 403 after login | Wait 1–2 hours, reduce scrape frequency |
| Datacenter IP blocked | Use a residential `proxy` (see [Configuration](configuration.md)) |
| Turnstile CAPTCHA | Run once headed (`headless: false`) to pass the initial challenge |
| Parallel-run failures | Share one browser and add a 2–5 s delay between banks |

Read `result.errorDetails.suggestions` first — it is populated per provider.
For how the challenge interceptor works, see
[WAF interceptor](architecture/waf-interceptor.md).

## Error types

Returned as `result.errorType` when `result.success` is `false`.

| Error | Meaning |
| --- | --- |
| `INVALID_PASSWORD` | Wrong credentials |
| `INVALID_OTP` | Wrong or expired OTP code |
| `TWO_FACTOR_RETRIEVER_MISSING` | OTP required but no `otpCodeRetriever` supplied |
| `CHANGE_PASSWORD` | The bank is forcing a password change — log in manually first |
| `ACCOUNT_BLOCKED` | The bank locked the account |
| `WAF_BLOCKED` | Cloudflare block — read `errorDetails.suggestions` |
| `TIMEOUT` | Page load timeout — raise `defaultTimeout` |
| `NETWORK_ERROR` | Transport failure reaching the bank |
| `GENERIC` | Pipeline phase failure — read `errorMessage` |
| `GENERAL_ERROR` | Deprecated alias of `GENERIC`, kept for older consumers |

`errorDetails` is populated for `WAF_BLOCKED` only; every other type carries its
context in `errorMessage`.

## Still stuck?

Attach **all three** of these to an issue:

1. `pipeline.log` — full Pino transcript
2. `network/*.json` — captured HTTP bodies
3. `screenshots/*.html` — DOM snapshots per phase

With redaction left at its default (`PII_REDACTION=on`) all three are scrubbed
at write time and safe to share publicly. Skip the `.png` files. See
[PII redaction](observability/redaction.md) for exactly what survives redaction
and why.

!!! danger "Artifacts from a `PII_REDACTION=off` run are not shareable"
    That switch disables redaction outright, so the same three files hold real
    account numbers, balances and auth tokens. Re-run with redaction on and
    attach the fresh artifacts instead of scrubbing the old ones by hand.
