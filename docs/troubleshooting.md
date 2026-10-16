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

### npm 12 blocks install scripts by default

npm 12 does not run a dependency's install script unless that dependency is
listed in your `allowScripts`. A plain `npm install` therefore leaves
better-sqlite3 unbuilt, and says so only in a warning that is easy to miss:

```
npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   better-sqlite3@12.11.1 (install: prebuild-install || node-gyp rebuild --release)
```

`npm rebuild better-sqlite3` alone **does not fix this**. It is blocked by the
same policy and still prints `rebuilt dependencies successfully` while building
nothing, so the error survives a remedy that reported success. Approve the
package first, then rebuild — both steps are required:

```bash
npm install-scripts approve better-sqlite3
npm rebuild better-sqlite3
```

`approve` records the decision in your `package.json` under `allowScripts`, so
it survives a reinstall. Run `npm install-scripts ls` to see what is blocked.

If that has to compile from source (no prebuild for your platform), install a
toolchain first:

```bash
sudo apt-get install -y python3 make g++   # Debian / Ubuntu
```

## `Version information not found`

The full text is:

```
Version information not found at <cache dir>/version.json. Please run `camoufox fetch` to install.
```

The Camoufox bundle is downloaded on **first launch**, not at install time.
This error means the cache directory exists and is not empty, but holds no
`version.json` — a first launch that was interrupted part-way through.

| OS | Cache directory |
|---|---|
| macOS | `~/Library/Caches/camoufox` |
| Linux | `~/.cache/camoufox` |
| Windows | `%LOCALAPPDATA%\camoufox\camoufox\Cache` |

Ignore the advice in the message. `camoufox fetch` is the Python CLI, which you
do not have as a Node consumer of this package. Delete the partial directory
and launch again — an **absent or empty** directory triggers a fresh download,
whereas a partial one does not:

```bash
rm -rf ~/Library/Caches/camoufox   # macOS; ~/.cache/camoufox on Linux
```

Set `CAMOUFOX_INSTALL_DIR` to relocate the cache — useful when the home
directory is ephemeral, as in a container without a persisted volume.

## `browser stack differs from the tested pair`

A `warn` log line, not an error. The scrape carries on. Each release is
tested against one Camoufox build and one `playwright-core` minor. After the
first successful Camoufox launch in a process, the installed versions are
compared with that pair, and each component that differs is logged once:

| Field | Meaning |
|---|---|
| `component` | `camoufox` or `playwright-core` |
| `installed` | The version found on this machine |
| `tested` | The version this release is tested against |
| `remedy` | How to get back to the tested version |

A different version often works. If a scrape then breaks, this line is the
first place to look.

**`camoufox`** — on first launch camoufox-js downloads the newest stable
(non-prerelease) Camoufox release that its version supports and that has a
build for your platform. After that it reuses the cache for as long as it
still supports the cached version, and a newer release alone never replaces
it, so an old cache keeps its old build. Only a missing, empty or unsupported
cache is fetched again. To refetch, delete the cache directory (see the table
under [`Version information not found`](#version-information-not-found)) and
launch again. That fetches the same kind of release, which is the tested one
only when the newest supported release is the tested tag. When it is not,
upgrade this package, which may test a newer build.

**`playwright-core`** — compared by minor; a patch release of the tested minor
counts as tested. The version read is the copy camoufox-js loads, since that
copy drives the browser; the dependency tree can hold more than one copy, and
the one beside this package is not necessarily it. The dependency range
accepts later minors, so a fresh install can resolve one newer than the tested
minor. An
`overrides` entry can also force one. Run `npm ls playwright-core` to see
every copy that resolves. To get back to the tested minor, pin it in your own
`package.json`, replacing `1.64` with the `tested` value from the log:

```json
"overrides": { "playwright-core": "~1.64.0" }
```

A version that cannot be read, such as Camoufox before its first download,
is skipped and noted at `debug` level only.

## `Cannot read properties of undefined (reading 'url')`

A scrape dies inside `playwright-core` with this `TypeError` and no stack frame
of ours in the trace.

This library listens for uncaught page errors. Playwright forwards every one of
them and reads `pageError.location.url` **without a null check**, but Camoufox
(Firefox) can report an uncaught error carrying no location — so the read
throws. Upstream still ships the unguarded read as of `playwright-core` 1.64.1.

A `postinstall` step adds the missing null guard for you. It is skipped when you
install with `--ignore-scripts`, so apply it by hand:

```bash
node node_modules/@sergienko4/israeli-bank-scrapers/scripts/patch-playwright-core.mjs
```

The script is idempotent and never fails an install — re-running it on an
already-guarded tree is a no-op. Set `SKIP_PLAYWRIGHT_CORE_PATCH=1` to opt out
entirely if you manage `playwright-core` patches yourself.

The copy that matters is the one Camoufox's launcher, `camoufox-js`, loads. A
dependency tree can hold more than one `playwright-core`: one nested under
`camoufox-js`, another hoisted at a different version, or pnpm symlinks. The
script patches each distinct copy, the one this package resolves and the one
`camoufox-js` resolves. When there are two, each copy's lines follow a
`playwright-core copy: <path>` header.

To check that the guard is in place, add `--strict`. It exits 0 only when, in
every copy, each read is guarded at exactly the 2 sites the reviewed
`playwright-core` has (the BrowserContext dispatcher and the trace recorder).
Otherwise it exits 1 and prints
`GUARD-SITES <index> <found>/<reviewed> <unguarded read>` for each read off
that count. A count other than 0 usually means your `playwright-core` build
moved a site, so its pageError reads need a fresh review. It also exits 1 when
any `pageError.location` read is left unguarded, whether written with `.`,
`?.` on `pageError`, or quoted brackets, printing
`GUARD-LEFT <count> unguarded pageError.location read(s)`. The check reads
text, so a mention inside a comment also fails it.

!!! note "Why a `scripts/` path exists in an installed package"
    Only `lib/**` ships normally. `scripts/patch-playwright-core.mjs` is the
    one deliberate exception in the package `files` allowlist, because the
    `postinstall` hook has to be able to run it from `node_modules`. No other
    repo script is published.

## `Protocol error (Network.setRequestInterception)`

A `page.route()` call fails with:

```text
Protocol error (Network.setRequestInterception): ERROR: failed to call method 'Network.setRequestInterception' with parameters {
```

`playwright-core` 1.64 added a `bypassServiceWorker` field to that call, and
no released Camoufox accepts it. `context.route()` is unaffected: Firefox turns
on context-wide interception through `Browser.setRequestInterception`, which did
not change. The same `postinstall` script from the previous section rewrites
the call to send `{ enabled }` alone, as 1.63 did. If you installed with
`--ignore-scripts`, run it by hand with the command shown there.

Under `--strict` the call must be sent at exactly 1 site, in that form. Every
mention of `Network.setRequestInterception` counts as a send, whatever its
quoting or line breaks, so a send the rewrite cannot read still fails the
check. A mismatch prints
`SHIM-SITES <shimmed>/<reviewed> (<sent> sent) <shimmed form>`, which means
your `playwright-core` build changed the call and needs a fresh review.

The same script also keeps multi-value `Set-Cookie` headers one entry per
cookie on 1.64. Camoufox reports a response's cookies as one header joined by
newlines, which 1.63 split and 1.64 does not, so without the script
`headersArray()` and `headerValues('set-cookie')` return one merged entry and
nothing reports an error. The script splits `Set-Cookie` alone, at the one
place the Firefox client builds a response. Under `--strict` that place must
be found in a form the script knows; otherwise it prints
`COOKIE-SITES <known>/<reviewed> (<sites> sites) <response site>`, which
means your `playwright-core` build needs a fresh review.

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
| `INVALID_PHONE_NUMBER` | `phoneNumber` is not usable for this bank. Pass digits-only international form (`972000000000`) or the bank's own wire form from its [bank guide](banks/index.md). Raised before any network call, so nothing was sent — the Israeli local form `0500000001` is refused on purpose rather than forwarded and rejected as an opaque auth failure |
| `CHANGE_PASSWORD` | The bank is forcing a password change — log in manually first |
| `ACCOUNT_BLOCKED` | The bank locked the account |
| `WAF_BLOCKED` | Cloudflare block — read `errorDetails.suggestions` |
| `TIMEOUT` | Page load, or an in-page request that exceeded its budget — see [Request deadlines](#request-deadlines) |
| `NETWORK_ERROR` | Transport failure reaching the bank |
| `GENERIC` | Pipeline phase failure — read `errorMessage` |
| `GENERAL_ERROR` | Deprecated alias of `GENERIC`, kept for older consumers |

`errorDetails` is populated for `WAF_BLOCKED` only; every other type carries its
context in `errorMessage`.

## Request deadlines

Some banks are driven by `fetch` calls issued inside the page rather than by
navigation. Those requests are bounded twice, and the two budgets are
deliberately not equal.

The deadline that decides the outcome is enforced in Node, at
`NETWORK_FETCH_TIMEOUT_MS`. Node owns that timer, so when it expires the scraper
knows the budget was exceeded and reports `TIMEOUT`. A second, later abort runs
inside the page at `NETWORK_FETCH_PAGE_TIMEOUT_MS` — `NETWORK_FETCH_TIMEOUT_MS`
plus `NETWORK_FETCH_PAGE_GRACE_MS` — purely so an abandoned request releases
browser-side resources.

The grace is what makes the ordering deterministic: Node always reaches its
deadline first, so the error you receive is the classified one. The in-page abort
only fires if the Node timer was starved, which in practice means the event loop
was blocked.

A `TIMEOUT` from this path usually means the bank is slow or the request never
settled, not that `defaultTimeout` is too low — that option governs page loads.

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
