# Structured events

Every phase emits structured Pino records. Each record carries an `event` field (kebab-case dotted scope) plus phase-specific fields. All fields go through `PiiRedactor` before write.

## Common fields

| Field | Type | Notes |
|---|---|---|
| `event` | string | `<phase>.<action>.<outcome>` — e.g. `balance-resolve.fetch.start` |
| `correlationId` | string | `randomUUID()` per phase invocation — correlates `.start` / `.success` / `.failure` records |
| `module` | string | Phase name |
| `bankAccountTail4` | string | `***NNNN` — last-4 of a bankAccountUniqueId, never the full id |

## Per-phase events

### INIT

| Event | Level | Fired when |
|---|---|---|
| `init.browser.launched` | info | Camoufox + context + page ready |
| `init.navigation.complete` | info | First nav to `loginUrl` returned |
| `INIT-ACTION-NAV-FAILURE` | warn | `executeNavigateToBank` failed — full transport-layer envelope, see [INIT navigation forensics](init-navigation-forensics.md) |

### LOGIN

| Event | Level | Fired when |
|---|---|---|
| `login.field.resolved` | debug | One credential field resolved via SelectorResolver |
| `login.submit` | info | Submit button clicked |
| `login.result.invalid_password` | warn | Bank returned credentials-wrong |
| `login.result.success` | info | Post-submit page recognised as authenticated |

### OTP-TRIGGER / OTP-FILL

| Event | Level | Fired when |
|---|---|---|
| `otp-trigger.sent` | info | Bank dispatched SMS/email |
| `otp-fill.retriever.invoked` | info | `otpCodeRetriever` callback called |
| `otp-fill.submit` | info | Code submitted |
| `otp-fill.result.invalid` | warn | Wrong/expired code |

### AUTH-DISCOVERY

| Event | Level | Fired when |
|---|---|---|
| `auth-discovery.scan.start` | debug | Pool scan begins |
| `auth-discovery.token.found` | info | Auth signal extracted |

### ACCOUNT-RESOLVE

| Event | Level | Fired when |
|---|---|---|
| `account-resolve.discovery.fetched` | info | Discovery call returned |
| `account-resolve.ids.count=N` | info | N account ids parsed |

### DASHBOARD

| Event | Level | Fired when |
|---|---|---|
| `dashboard.ui.click` | info | Dashboard affordance clicked |
| `dashboard.endpoint.detected` | info | Txn endpoint URL identified |
| `dashboard.halt.<gate>` | error | F-DASH-1 / F-DASH-2 / F-DASH-3 |

### SCRAPE

| Event | Level | Fired when |
|---|---|---|
| `scrape.pre.priming.start` | debug | Forensic priming starting |
| `scrape.account.start` | info | Per-account iteration begins |
| `scrape.account.complete` | info | Per-account walk done |
| `scrape.post.empty-gate.<verdict>` | info/warn | Empty-gate heuristic outcome |
| `--- Account *** | N txns ---` | info | Forensic audit line — see [Forensic audit](forensic-audit.md) |

### BALANCE-RESOLVE

| Event | Level | Fired when |
|---|---|---|
| `balance-resolve.fetch.start` | info | Each live fetch begins (one per plan entry) |
| `balance-resolve.fetch.success` | info | Fetch returned successfully |
| `balance-resolve.fetch.failure` | warn | Quarantined per-fetch failure |
| `balance-resolve.post resolved=N missed=M total=K` | debug | Partition outcome |
| `balance.miss` | warn | One per missed account (under `.post`) |
| `balance-resolve.final` | info | REVEAL log emitted with `resolvedCount`, `missedCount`, `totalCount` |

### TERMINATE

| Event | Level | Fired when |
|---|---|---|
| `terminate.cleanup.page` | debug | Page closed |
| `terminate.cleanup.context` | debug | Context closed |
| `terminate.cleanup.browser` | debug | Browser closed |
| `Result: success=<bool> | errorType=<type>` | info | Final outcome line |

## Reading the log

```sh
# Watch the live log
tail -f pipeline.log | jq .

# Find all BALANCE-RESOLVE events for a run
grep "balance-resolve" pipeline.log | jq .

# Find every fetch quarantine
jq -c 'select(.event == "balance-resolve.fetch.failure")' pipeline.log
```
