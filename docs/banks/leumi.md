# Bank Leumi

|                |                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Leumi`                                                                                                                                                  |
| Engine         | **API-direct** (no browser)                                                                                                                              |
| Transport      | Node's own `fetch` with a session cookie jar                                                                                                             |
| Credentials    | `username`, `password`                                                                                                                                   |
| OTP            | Unsupported challenges stop the run                                                                                                                      |
| Phase chain    | API-DIRECT-CALL → API-DIRECT-SCRAPE                                                                                                                      |
| Source         | [`Banks/Leumi/LeumiPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Leumi/LeumiPipeline.ts) |

## Quick example

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.Leumi,
  startDate: new Date('2024-01-01'),
});

const result = await scraper.scrape({
  username: 'myuser',
  password: 'mypassword',
});
```

## Login and configuration

Leumi logs in and reads financial data over its web APIs with Node's own
`fetch`. Every run starts with a fresh session and key exchange. The SDK
reference is discovered but its code is not executed; its bytes must match
the reviewed digest before credentials are submitted. An SDK change therefore
stops login until the integration is reviewed and updated.

Credentials remain `username` and `password`, including the original username
casing. Unsupported challenges, including OTP, stop the run; there is no
browser fallback. Password-change requests are reported as `CHANGE_PASSWORD`.
The pipeline does not automatically retry failed phases or connect timeouts.
An invalid `startDate` is refused before any bank request.
HTTP 429 is reported as `WAF_BLOCKED` and stops the run without a retry.

Browser options such as `preparePage`, `prepareBrowser` and
`shouldShowBrowser` are removed from the public API; remove them from Leumi
options. See the [migration notes](../configuration.md#removed-browser-options).

## Known quirks

- The supported login is a password challenge; an OTP or other unsupported challenge stops rather than being submitted.
- Transactions come from Leumi's WCF module `UC_SO_27_GetBusinessAccountTrx`; its rows carry the date as `DateUTC` and the per-txn identifier as `FITID`. `ReferenceNumberLong` is a fallback alias, not a unique identifier.
- Balance is per-bank-account, resolved by the hard-model balance step.

## Hard-model post-auth

After login, Leumi uses the hard-model post-auth path. The bank's
`IApiDirectScrapeShape`
(account-list, balance, and transactions helpers under `Banks/Leumi/scrape/`:
`extractAccounts`, `balanceVars` / `balanceExtract`, `txnsVars` /
`txnsExtractPage`) declares each endpoint. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.

The internal `LEUMI_BODY_CHECKS` require each WCF response to pass its
operation-specific envelope and status check before account, balance or
transaction fields are extracted. A non-object outer envelope, including
JSON `null`, returns a sanitized validation failure without further financial
requests. `validAccounts` rejects missing or duplicate
account identifiers before account-specific calls, and
`validTransactionAmount` requires the shared mapper to use the row's own
`Amount`, rejects nested or non-finite original amounts and refuses sign
changes from unrelated fields. `validTransactionSource` requires a complete, valid
root `DateUTC` and a usable root `FITID` or `ReferenceNumberLong`, and rejects
conflicting mapper aliases. Identifiers containing control characters are
unusable. `normalizeTransactionIdentifier` removes unusable `FITID` placeholders
so the fallback can be mapped. Valid dates are normalized to UTC before mapping;
dates without an offset use the bank's calendar timezone. Leumi is explicitly
mapped as a bank, not a card issuer.
`leumiResultGuard` rejects missing loss evidence or observed transaction loss.
A genuine zero balance and an empty
transaction list remain valid. Leumi encodes an empty transaction window as
`HistoryTransactionsItems: null`; the guard accepts it as empty, matching the
extractor. An unproven history window is not itself
evidence of loss or a claim of complete coverage.

## Native login details

The registered `buildLeumiNativePipeline` descriptor uses
`LEUMI_API_DIRECT_CALL` for the login steps and `LEUMI_TRANSPORT` for the
native transport, cookie jar, redirect policy and response limits.

For maintainers, `LEUMI_BOOTSTRAP_PATHS` and `LEUMI_BOOTSTRAP_STEPS` define
fresh entry, gatekeeper, pinned SDK verification and session reset;
`CLIENT_PROFILE` supplies the observed request profile. The SDK is checked
before identity submission and is never executed.
`LEUMI_TRANSMIT_PATHS`, `LEUMI_TRANSMIT_SEEDS` and
`LEUMI_TRANSMIT_STEPS` define the fresh encrypted login. Its request templates
are `LEUMI_EXCHANGE_BODY`, `LEUMI_LOGIN_BODY` and `LEUMI_PASSWORD_BODY`;
`LEUMI_LOGIN_CLASSIFIER` and `LEUMI_PASSWORD_CLASSIFIER` reject unsupported
challenge and completion states.

The handoff uses `LEUMI_PORTAL_PATHS`, `LEUMI_PORTAL_SEEDS` and
`LEUMI_PORTAL_STEPS`. `LEUMI_JWT_CAPTURE` binds issued claims to the current
flow and `LEUMI_SITE_GUARD` admits only supported site codes. `ENTRY_RULES`,
`SSO_RULES` and `SPA_RULES` constrain destinations under `ORIGIN`;
`PAGE_LIMIT` bounds HTML and `COMMON_HEADERS` carries the observed request
profile. The `/authenticate` response is parsed as JSON despite its observed
`text/html` media type; other JSON endpoints retain their normal media-type
checks. The token binding parses claims but does not independently verify the
JWT signature.

The SPA handoff selects one distinct matching serialized `SessionID` from
active script syntax. It does not establish the assignment's provenance.
