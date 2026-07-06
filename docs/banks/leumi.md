# Bank Leumi

|                |                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Leumi`                                                                                                                                                  |
| Engine         | Browser (Pipeline)                                                                                                                                       |
| Credentials    | `username`, `password`                                                                                                                                   |
| OTP            | —                                                                                                                                                        |
| Phase chain    | INIT → HOME → LOGIN → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE (hard-model post-auth)                                                          |
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

## Pipeline specifics

Leumi is a **real-browser** Pipeline bank: Camoufox drives `https://www.leumi.co.il` through a generic (visible-text) login, then a **hard-model** post-auth shape issues Leumi's exact WCF API calls directly — no generic network-traffic discovery. Its config entry ([`Registry/Config/PipelineBankConfig.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Registry/Config/PipelineBankConfig.ts)) is minimal:

| Key                | Value                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| `urls.base`        | `https://www.leumi.co.il` — INIT navigates here; LOGIN reuses it as the login URL |
| `balanceKind`      | `ACCOUNT` — live balance resolved per bank-account by the hard-model balance step |
| `authStrategyKind` | `SESSION_COOKIE` — the session is carried by cookies, not a bearer token          |

**Login is zero-config.** `LEUMI_LOGIN` ships **empty selector arrays** and the migration added **no `LoginWK` entries** — `SelectorResolver` matches the `username`/`password` inputs and submit button from the generic Well-Known login candidates (visible text), per the repo's ZERO-CSS-selectors rule. The builder wires only `.withBrowser()` + `.withDeclarativeLogin(LEUMI_LOGIN)`, so there is no PRE-LOGIN and no OTP.

**Login + response normalization extend generic Well-Known dictionaries.** The migration added bank-specific values to generic WK dictionaries. With the hard-model post-auth path, the endpoint-discovery patterns (`ScrapeWK` / `DashboardWK` below) are **legacy** — retained but superseded by the shape's direct WCF broker call (`leumiBrokerUrl(UC_SO_27_GetBusinessAccountTrx)`); the field-mapping and login entries stay active:

| Generic dictionary       | Leumi's addition                                                         | Why it's needed                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ScrapeWK.ts`            | `/GetBusinessAccountTrx/i` list-endpoint pattern                         | (legacy) generic-discovery pattern for Leumi's `Trx`-abbreviated WCF txn module; the hard-model shape now calls this module directly                                                                   |
| `DashboardWK.ts`         | `/\bBusinessAccountTrx\b/i` route pattern                                | (legacy) Leumi's SPA hash-route for the transactions view; unused now that the hard-model path has no DASHBOARD phase                                                                                  |
| `ScrapeFieldMappings.ts` | `accountsItems` container · `DateUTC` date alias · `ReferenceNumberLong` | maps Leumi's WCF `UC_SO_27_GetBusinessAccountTrx` rows (and the accounts container) onto the canonical shape — without the `DateUTC` alias, `autoMapTransaction` rejects every Leumi txn as empty-date |
| `ScrapeIdFields.ts`      | `MaskedNumber` · `AccountIndex`                                          | Leumi's account display-id / query-id field names                                                                                                                                                      |
| `SharedWK.ts`            | `'סגירה'` close-popup text (ariaLabel + exactText)                       | dismiss Leumi's cookie-consent overlay so HOME can reach the login link                                                                                                                                |

To add a bank like this, see [Adding a new bank](../contributing/new-bank.md) — it walks through the same builder-and-Well-Known steps Leumi uses.

## Known quirks

- HOME dismisses Leumi's cookie-consent overlay (the `'סגירה'` close control added to `SharedWK`) before it can reach the login link.
- No OTP — plain `username`/`password` login. The login flow is generic (visible-text WK candidates); post-auth uses the hard-model shape (see below), **not** generic network-traffic discovery.
- Transactions come from Leumi's WCF module `UC_SO_27_GetBusinessAccountTrx`, which the hard-model shape POSTs directly; its rows carry the date as `DateUTC` and the per-txn reference as `ReferenceNumberLong`, normalized via the field mappings above.
- Balance is per-bank-account (`balanceKind: ACCOUNT`), resolved by the hard-model balance step.

## Hard-model post-auth

After login, Leumi uses the hard-model post-auth path
(`withBrowserApiDirect`): the exact API calls are issued directly through the
live login page instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE /
DASHBOARD / SCRAPE / BALANCE-RESOLVE chain. The bank's `IApiDirectScrapeShape`
(account-list, balance, and transactions helpers under `Banks/Leumi/scrape/`:
`extractAccounts`, `balanceVars` / `balanceExtract`, `txnsVars` /
`txnsExtractPage`) declares each endpoint. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.

