# Pepper (by Bank Leumi)

|                |                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CompanyTypes` | `Pepper`                                                                                                                                                     |
| Engine         | **API-direct** (no browser)                                                                                                                                  |
| Credentials    | `phoneNumber`, `password`, `otpCodeRetriever`                                                                                                                |
| OTP            | Required                                                                                                                                                     |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                        |
| Phone format   | `international-flat` (`972000000000`)                                                                                                                        |
| Durable auth   | Opt-in — see [Durable device auth](#durable-device-auth-opt-in)                                                                                              |
| Source         | [`Banks/Pepper/PepperPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Pepper/PepperPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  phoneNumber: '972000000000',
  password: 'mypassword',
  otpCodeRetriever: async () => await myInbox.getCode(),
});
```

## Durable device auth (opt-in)

Pepper's access token is short-lived. In the default **token-only** mode a run
reuses `otpLongTermToken` while it is fresh, and pays one SMS for a cold login
once it has expired.

**Durable state** mode keeps what the app keeps: the device Pepper bound during
enrollment and that device's signing key. A later run renews an expired token
on that device with the password alone — no SMS, no new device.

### Usage

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const stored = await mySecretStore.read('pepper-device'); // undefined on the first run

const scraper = createScraper({
  companyId: CompanyTypes.Pepper,
  startDate: new Date('2024-01-01'),
  ...(stored === undefined ? {} : { persistentAuthState: stored }),
  onPersistentAuthStateUpdate: async state => {
    // Replace only if storage still holds `stored`; resolve after the write is durable.
    await mySecretStore.replaceIfUnchanged('pepper-device', stored, state);
  },
});

const result = await scraper.scrape({
  phoneNumber: '972000000000',
  password: 'mypassword',
  otpCodeRetriever: async () => await myInbox.getCode(),
});
```

Leave `persistentAuthState` out when nothing is stored, as above. An empty
string counts as a supplied state and fails as
`persistent auth state invalid: encoding`.

### What each run does

| Options                                                 | Mode                   | Network and callback                                                                                        |
| ------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| Neither option                                          | Token-only (unchanged) | Existing behavior                                                                                           |
| Callback, no state                                      | Enrollment             | The normal cold login — **one SMS** — then the callback once with the new state                             |
| State and callback, token fresh for more than 5 minutes | Replay                 | Zero auth requests, no callback                                                                             |
| State and callback, token expiring or expired           | Renewal                | A signed login plus one password assertion — **no SMS** — then the callback once with the replacement state |
| State without callback                                  | Invalid                | Fails before any request                                                                                    |
| Either option with `otpLongTermToken`                   | Invalid                | Fails before any request                                                                                    |

The phone credential is unchanged, so its type still requires an
`otpCodeRetriever`. Enrollment calls it; replay and renewal are guaranteed
never to.

Durable mode never calls `onAuthFlowComplete` and never fills
`result.persistentOtpToken` — those belong to token-only mode.

### The state is a secret

The state is encoded, **not encrypted**. It holds a bearer token and the
device's private signing key, so anyone holding it can act as that device.
Store it like a password, and never log it or attach it to a bug report.

### The callback contract

- Runs once after an enrollment or a renewal; never for a replay or a failed
  auth flow, and never retried. The state it stored stays valid even if a
  later data request in the same run fails.
- Must resolve only after the state is durably stored. A rejection or throw
  fails the run before the new token is used.
- Concurrency is the caller's job. Run one Pepper scrape per account at a time,
  and have the callback replace the stored value only if it still matches the
  state this run started with. The library makes no cross-process atomicity
  claim.

### Failures never fall back

A failed resume never sends an SMS, never binds a new device, and never falls
back to a cold login. In durable mode only an enrollment sends an SMS: once its
OTP step has run, a later failure — such as a callback that rejects — has
already used it. Failures from the library's own checks are
`GENERIC` and carry only a category, never the state or the token:

| Message                                       | Categories                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `persistent auth options invalid: <category>` | `malformed` (wrong runtime type), `state-with-legacy-token`, `callback-with-legacy-token`, `state-without-callback`, `account` (callback set, but the phone number is missing, empty or not text) |
| `persistent auth state invalid: <category>`   | `encoding` (including an empty string), `json`, `shape`, `version`, `provider`, `account` (state belongs to another phone number), `clientInstanceId`, `deviceId`, `accessToken`, `ecPrivateKey`  |
| `persistent auth failed: <category>`          | `callback` (store rejected), `enrollment-budget`, `enrollment-identity`, `enrollment-key`                                                                                                         |

When Pepper itself refuses the renewal — an unknown device or a rejected
signature — the run fails with the error the login step reports, still
without an SMS. It keeps that step's type: usually `GENERIC`, or `WAF_BLOCKED`
/ `TIMEOUT` when the request itself was blocked or timed out. That error names
the endpoint and Pepper's reply but never the
query string, and any stored value the reply quotes back is replaced with
`[REDACTED]`. An enrollment that fails mid-flow also reports its step's error
without the query string; it stores nothing.

**Recovery is always explicit.** Remove the stored state and run once with the
callback only to re-enroll (one SMS). The library never re-enrolls on its own.

A token that is still fresh locally but has been revoked by Pepper fails at the
first data request, and the run reports that request's own 401 or 403 error.
Durable mode does not renew mid-scrape: it refuses the renewal and logs a
warning, which is why no `in-run-renewal` message ever reaches the caller.
Remove the state and re-enroll, or wait until the token is inside the 5-minute
renewal margin.

### Migration

- **Token-only → durable:** stop passing `otpLongTermToken` and run once with
  only `onPersistentAuthStateUpdate`. That run is a normal enrollment and sends
  one SMS.
- **Durable → token-only:** stop passing both options. Token-only behavior
  returns immediately.

### Not supported yet

Each needs new live evidence first; until then the run fails closed:

- server-requested signing-key rotation;
- a login that completes without a password assertion;
- renewal in the middle of a scrape;
- automatic re-enrollment;
- an encryption API, or a timeout or retry for the callback.

### Real-bank E2E

The durable run lives in its own opt-in suite,
`PepperDurable.e2e-real.test.ts`. It scrapes once and never falls back to a
cold SMS run, so it is a single-attempt suite rather than a
WarmPathFallback one. Each flag is on when set to any non-empty value and off
when unset or empty:

| Flags                                                            | Run                                                                                         | SMS  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---- |
| `PEPPER_PERSISTENT_AUTH` + `PEPPER_PERSISTENT_AUTH_ENROLL`       | Enrollment; stores the state in `<os.tmpdir()>/pepper-durable.cache`                        | One  |
| `PEPPER_PERSISTENT_AUTH`                                         | Resume from the cached state; replay or renewal, predicted from the cached token            | None |
| `PEPPER_PERSISTENT_AUTH` + `PEPPER_PERSISTENT_AUTH_FORCE_EXPIRY` | Resume with the cached token swapped, in memory only, for an expired one — forces a renewal | None |

Without `PEPPER_PERSISTENT_AUTH` the durable suite skips, the legacy
`Pepper.e2e-real.test.ts` runs, and the other two flags are ignored. With it,
the legacy suite skips, so one run executes exactly one of the two. A resume
with no cached state fails before scraping rather than enrolling, and setting
both `ENROLL` and `FORCE_EXPIRY` is refused.

```bash
PEPPER_PERSISTENT_AUTH=1 npm test -- --testPathPatterns=E2eReal/PepperDurable.e2e-real
```

## Known quirks

- Uses **asymmetric (ECDSA-P256 / RSA-2048) signing** with the signature attached as a request header.
- **GraphQL throughout** — a single gateway serving three operations
  (`UserDataV2`, `fetchAccountBalance`, `Transactions`). The gateway also
  requires a `queryname` request header matching the operation name, supplied
  by the scrape shape as `extraHeaders`.
- Pepper is on the Headless mediator path — its `PipelineDescriptor` is composed via the fluent `PipelineBuilder` rather than the declarative literal style.
- Only **current accounts** are scrapeable; every other product the profile holds is skipped at discovery (see below).

## Unsupported account products

Pepper's `oshTransactionsNew` resolver serves current accounts only. Asked for
any other product it answers HTTP `400` inside a GraphQL `errors` array, while
the HTTP transport itself still reports `200`. Because the account walk
short-circuits on the first failure, a single foreign-currency or securities
product used to discard the **entire** scrape — the caller got nothing, not
even the current account that would have succeeded ([issue #550]).

Products are therefore filtered at discovery by `isSupportedAccount`, so an
unsupported one is never requested at all.

`PEPPER_SUPPORTED_ACCOUNT_CATEGORIES` is deliberately an **allow-list**, not a
deny-list of the reported `Foreign` / `SecuritiesAccount` values: `Ils` is the
only category confirmed against a live production account, so an unrecognised
future category is excluded rather than assumed serviceable.

The inverse risk — silently dropping an account that holds real money — is
handled by treating a product with **no usable category** as supported:
absent, `null`, and blank values are all retained, so a schema change fails
loudly at the resolver instead of vanishing. Only a non-blank _unrecognised_
category is excluded, and the allow-list comparison stays exact so a padded
near-miss such as `' Ils '` is never normalised into a supported value.

Filtering is observable rather than silent. `countDiscovered` reports how many
products the payload declared, and when any were excluded the phase emits one
`ACCOUNTS_FILTERED_LOG` line carrying counts only — no account identifiers, no
balances.

Reporting can never decide the outcome. `countDiscovered` is bank-specific
code that may throw, so `reportExcludedProducts` is total by construction: a
throw is contained and re-surfaced as one `EXCLUSION_REPORT_FAILED` warning
instead of discarding a scrape that had already fetched real money. Contained
is not hidden — a diagnostics channel that has stopped working stays visible.
Conversely, the reporting call sits outside the `extractAccounts` try/catch so
only a genuine extractor failure can be blamed for `extractAccounts threw`.

Nor can reporting publish a number it cannot believe. A count that is not a
whole number, or that is smaller than the number of accounts the extractor
kept, is rejected through that same warning path rather than reaching the log.
Both failure modes were silent-omission defects one level down: a non-integer
delta would be published as a measurement it is not (`excluded: NaN`), while
an under-count produced a negative delta that suppressed the report entirely.

The containment is text-free and self-terminating. What the throw carries is
bank-authored — an `Error.message` can quote an account number the payload
held — so the warning names only the exception's _type_, never its message,
keeping the counts-only promise the log line above already makes. And because
the last thing that can fail is the act of reporting a failure, the warning
emission is wrapped in turn: a logger whose `warn` throws is swallowed rather
than allowed to discard the scrape it was only meant to describe.

Blame is placed only where it can be placed honestly. The shape's counter is
contained at its own call site, so a counter that throws is named as such;
everything further in — the exclusion line's own `info` emission included —
fails for reasons no bank shape caused, and the last-resort catch therefore
reports a generic report failure rather than sending an operator off to read
blameless code.

## Balance is truthful, never a fabricated zero

Pepper's balance step declares `fallbackOnFail: BALANCE_UNKNOWN`. A rejected
balance fetch therefore degrades the run instead of failing it, but the
resulting account **omits the `balance` key entirely** rather than reporting
`0`. `ITransactionsAccount.balance` is optional, so leaving it out is the only
truthful way to say "not known" — a zero would be a number the bank never sent
and reads as an empty account.

[issue #550]: https://github.com/sergienko4/israeli-bank-scrapers/issues/550
