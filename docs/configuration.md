# Configuration

Everything is configured through two typed objects: `ScraperOptions` at
construction time and `ScraperCredentials` at scrape time. Nothing else reads
from disk, and the only environment variables consulted are the operational
ones listed at the bottom of this page.

Legacy and browser-specific options from earlier releases have been removed
from `ScraperOptions` — see [Legacy](architecture/legacy.md) and
[Removed legacy options](#options-the-pipeline-ignores).

## Scraper options — `createScraper({ ... })`

| Field                         | Type                                     | Default       | What it controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `companyId`                   | `CompanyTypes` (enum)                    | **required**  | Picks the bank — an id with no Pipeline entry throws `unknown company id <id>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `startDate`                   | `Date`                                   | **required**  | Earliest transaction date to fetch; must be a valid finite `Date` or the run fails before any request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `futureMonthsToScrape`        | `number`                                 | `1`           | How far past today to reach for scheduled transactions; an integer from 0 to 24, or the run fails before any request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `otpCodeRetriever`            | `(phoneHint: string) => Promise<string>` | (none)        | Invoked when the bank requires an OTP. API-direct flows also accept it in credentials; `phoneHint` is bank-specific and may be empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `onAuthFlowComplete`          | `(info: IAuthFlowInfo) => void`          | (none)        | Fires once authentication finishes, before scraping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `otpTimeoutMs`                | `number` (ms)                            | bank-specific | How long to wait for `otpCodeRetriever` to resolve                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `loginLogLevel`               | `'info' \| 'trace'`                      | `'info'`      | Raises authentication-chain log detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `persistentAuthState`         | `string`                                 | (none)        | **Pepper, Beinleumi, Massad, Otsar Hahayal and Pagi** — opaque device-auth state previously handed to `onPersistentAuthStateUpdate`. Pepper's holds a bearer token and a device private key, Beinleumi's, Massad's, Otsar Hahayal's and Pagi's the provider, the lower-cased `username` and the device id: store it as a secret. Requires `onPersistentAuthStateUpdate`. Omit it when nothing is stored — an empty string fails as invalid state — see [Pepper durable device auth](banks/pepper.md#durable-device-auth-opt-in), [Beinleumi warm start](banks/beinleumi.md#warm-start), [Massad warm start](banks/massad.md#warm-start) and [Otsar Hahayal warm start](banks/otsar-hahayal.md#warm-start) |
| `onPersistentAuthStateUpdate` | `(state: string) => Promise<void>`       | (none)        | **Pepper, Beinleumi, Massad, Otsar Hahayal and Pagi** — opts into durable device auth. Called once after an enrollment or a renewal with the state to store (Beinleumi, Massad, Otsar Hahayal and Pagi: once, on enrollment); a rejection fails the run before the new token is used. Other banks ignore it                                                                                                                                                                                                                                                                                                                                                                                               |

Before a bank's credential enricher or the first request, the public boundary
validates the options and credentials. Invalid `startDate`,
`futureMonthsToScrape`, `persistentAuthState` or credentials return a `GENERIC`
failure naming only the field: ordinary credential fields are 1–256 characters,
`deviceSignature` is at most 8,192, and `otpLongTermToken` is at most 16,384.
`persistentAuthState` is bounded by the codec's `MAX_ENCODED_CHARS` envelope
(32 KiB). Each bank also declares its required credential fields; the shared
`checkCredentialRules` helper applies the same rules at the boundary and in the
login flow. An unknown `companyId` still throws `unknown company id <id>` when
the scraper is created.

Request deadlines belong to the HTTP transports, not browser navigation.
See [Request deadlines](troubleshooting.md#request-deadlines).

<a id="options-the-pipeline-ignores"></a>

## Removed legacy options

The deprecated legacy-only options (`includeRawTransaction`, `optInFeatures`,
`outputData`, `shouldAddTransactionInformation`, `shouldCombineInstallments`,
`usePipeline`, `verbose`) were removed from `ScraperOptions` in v10.0.0. The
former readers belonged to the removed [legacy](architecture/legacy.md) path.

| Option                            | Replacement / Status                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `includeRawTransaction`           | Removed — set `FORENSIC_TRACE=true` and read `network/*.json` for raw provider payloads    |
| `optInFeatures`                   | Removed — enrichment is enabled automatically on every bank that provides the data         |
| `outputData`                      | Removed — date formatting and installment normalization are standardized across all banks  |
| `shouldAddTransactionInformation` | Removed — enrichment fields (`category`, `memo`, `identifier`) are populated automatically |
| `shouldCombineInstallments`       | Removed — installment transactions are emitted directly as reported by each bank           |
| `usePipeline`                     | Removed — every registered bank runs on the Pipeline                                       |
| `verbose`                         | Removed — use `LOG_LEVEL` or `loginLogLevel`                                               |

Raw provider payloads **are** available on the Pipeline — set
`FORENSIC_TRACE=true` and read `network/*.json`. See
[Observability](observability/index.md).

<a id="browser-lifecycle-options"></a>
<a id="browser-options-on-browserless-banks"></a>

## Removed browser options

Browser ownership, page hooks, navigation timeouts, viewport settings and
screenshot options are **removed**, not accepted with a warning. Every bank
uses HTTP, and there is no browser fallback. Remove those fields from
`createScraper` calls; the complete breaking-change list is in
[Compatibility](compatibility.md).

## Per-bank credentials — `scraper.scrape({ ... })`

Field names per bank are listed in [Supported institutions](banks/index.md).
They are validated at runtime, so a typo fails fast with a named field rather
than a login timeout.

API-direct banks (OneZero, Pepper, PayBox) additionally accept:

| Field              | Purpose                                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phoneNumber`      | Digits-only international form (no `+`, no dashes) — e.g. `972000000000`; a value already in the bank's own wire form is accepted unchanged. The mediator rewrites it to each bank's wire format, and fails the run with `INVALID_PHONE_NUMBER` when it cannot — including for the natural local form `0500000001`. |
| `otpCodeRetriever` | Passed in **credentials**, not options, for these three banks                                                                                                                                                                                                                                                       |
| `otpLongTermToken` | Persistent token returned in `result.persistentOtpToken` — supply it to skip the SMS round-trip on the next run                                                                                                                                                                                                     |

VisaCal is API-direct but has no OTP: it takes `username` and `password`, and
an optional `otpLongTermToken` that skips the password step — see
[Visa Cal](banks/visacal.md#warm-start). Isracard and Amex work the same way with
`id`, `card6Digits` and `password` — see [Isracard](banks/isracard.md#warm-start)
and [Amex](banks/amex.md). Max and Mizrahi take only `username` and `password`
and have no long-term token — see [Max](banks/max.md) and
[Mizrahi](banks/mizrahi.md). Hapoalim takes `userCode` and `password`, and its
`otpCodeRetriever` in either the options or the credentials, and an optional
`otpLongTermToken` that skips the login and the SMS — see
[Hapoalim](banks/hapoalim.md#warm-start). Yahav takes `num`, `nationalID` and
`password`, and an optional `otpLongTermToken` that skips the device enrolment —
see [Yahav](banks/yahav.md#warm-start).

The phone-format rewrite is per-bank and automatic; see
[API-DIRECT-CALL](phases/api-direct-call.md) for the normaliser contract.

`otpLongTermToken` is **token-only** mode: it carries a bearer token and
nothing else, so once that token expires the next run needs an SMS. Pepper
also offers **durable state** mode through the two `persistentAuth*` options
above, which keeps the bound device and renews an expired token without an
SMS. The two modes are mutually exclusive — combining them fails the run
before any request. See
[Pepper durable device auth](banks/pepper.md#durable-device-auth-opt-in).
Beinleumi, Massad, Otsar Hahayal and Pagi offer the same options as device memory:
their state names the provider, the lower-cased `username` and the device id
but carries no token, so the bank may still ask for an SMS — see
[Beinleumi warm start](banks/beinleumi.md#warm-start),
[Massad warm start](banks/massad.md#warm-start),
[Otsar Hahayal warm start](banks/otsar-hahayal.md#warm-start) and
[Pagi warm start](banks/pagi.md#warm-start).

## Environment variables

All optional.

| Variable          | Default                                        | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PII_REDACTION`   | `on`                                           | Set to `off` for real-bank E2E **only**. It disables redaction of `pipeline.log` and `network/*.json`, so those files may then hold real business data and credentials. Unit tests always run with redaction default-on.                                                                                                                                                                                                                                                                                        |
| `FORENSIC_TRACE`  | unset                                          | `true` writes `pipeline.log` and `network/*.json` under the run folder in `RUNS_ROOT`. See [Observability](observability/index.md)                                                                                                                                                                                                                                                                                                                                                                              |
| `RUNS_ROOT`       | `<os tmpdir>/israeli-bank-scrapers-<uid>/runs` | Parent directory for the forensic run folder. The per-user segment (POSIX UID; Windows temp is already per-user) keeps a `0700` root private without blocking other users of a shared `/tmp`. It must be a private, user-owned location: group/world-writable or symlinked path components are rejected. The default used to be the literal `C:\tmp\runs`; set `RUNS_ROOT` to keep the old location. Directories are created `0700` and `pipeline.log` `0600` — see [PII redaction](observability/redaction.md) |
| `LOG_LEVEL`       | pino default                                   | Pino verbosity only; decoupled from `FORENSIC_TRACE`. Has no observable effect until a destination is enabled — the logger is silent unless `FORENSIC_TRACE` or `PRETTY_LOGS` asks for one                                                                                                                                                                                                                                                                                                                      |
| `PRETTY_LOGS`     | unset                                          | `true` (exactly — the flag is default-deny) routes logs through `pino-pretty` for human-readable terminal output. It is a **development** convenience: `pino-pretty` is a devDependency, so it is absent from a consumer's production install. Asking for it there is not fatal — the root logger emits a process warning and degrades to the file transport, or to silence — see [Observability](observability/index.md#pretty-terminal-output)                                                                |
| `WINDOW_BACKFILL` | on                                             | `off` is the operator kill-switch; any other value leaves backfill on — see [API-DIRECT-SCRAPE](phases/api-direct-scrape.md)                                                                                                                                                                                                                                                                                                                                                                                    |
| `MOCK_MODE`       | unset                                          | `1` switches `test:mock` to its fixture-driven path                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Files written to disk

The "Redacted?" column assumes the default `PII_REDACTION=on`. Setting it to
`off` turns each ✅ below into a ❌. No browser cache, DOM snapshot or
screenshot is created.

| Path                   | Contents             | Redacted?                               |
| ---------------------- | -------------------- | --------------------------------------- |
| `<run>/pipeline.log`   | Pino transcript      | ✅ censored before any transport writes |
| `<run>/network/*.json` | Captured HTTP bodies | ✅ redacted before write                |
