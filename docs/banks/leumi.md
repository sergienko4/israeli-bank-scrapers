# Bank Leumi

|                |                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Leumi`                                                                                                                                                  |
| Engine         | Browser (Pipeline)                                                                                                                                       |
| Credentials    | `username`, `password`                                                                                                                                   |
| OTP            | —                                                                                                                                                        |
| Phase chain    | INIT → HOME → LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE                                                |
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

Leumi is a **real-browser** Pipeline bank: Camoufox drives `https://www.leumi.co.il`, and post-login network-traffic discovery does the rest — no imperative scraping code. Its config entry ([`Registry/Config/PipelineBankConfig.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Registry/Config/PipelineBankConfig.ts)) is minimal:

| Key                | Value                                                                             |
| ------------------ | --------------------------------------------------------------------------------- |
| `urls.base`        | `https://www.leumi.co.il` — INIT navigates here; LOGIN reuses it as the login URL |
| `balanceKind`      | `ACCOUNT` — live balance resolved per bank-account in BALANCE-RESOLVE             |
| `authStrategyKind` | `SESSION_COOKIE` — the session is carried by cookies, not a bearer token          |

**Login is zero-config.** `LEUMI_LOGIN` ships **empty selector arrays** and the migration added **no `LoginWK` entries** — `SelectorResolver` matches the `username`/`password` inputs and submit button from the generic Well-Known login candidates (visible text), per the repo's ZERO-CSS-selectors rule. The builder wires only `.withBrowser()` + `.withDeclarativeLogin(LEUMI_LOGIN)`, so there is no PRE-LOGIN and no OTP.

**Everything past login extends generic Well-Known dictionaries.** The migration added bank-specific values to five otherwise-generic WK dictionaries — the normal shape of a browser-bank change, not an exception:

| Generic dictionary       | Leumi's addition                                                         | Why it's needed                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ScrapeWK.ts`            | `/GetBusinessAccountTrx/i` list-endpoint pattern                         | Leumi's WCF txn module abbreviates `Trx` (not `Transactions`), so the generic `get\w*Transactions` pattern misses it                                                                                   |
| `DashboardWK.ts`         | `/\bBusinessAccountTrx\b/i` route pattern                                | Leumi's SPA hash-route (`SPA.aspx#/ts/BusinessAccountTrx`) for the transactions view                                                                                                                   |
| `ScrapeFieldMappings.ts` | `accountsItems` container · `DateUTC` date alias · `ReferenceNumberLong` | maps Leumi's WCF `UC_SO_27_GetBusinessAccountTrx` rows (and the accounts container) onto the canonical shape — without the `DateUTC` alias, `autoMapTransaction` rejects every Leumi txn as empty-date |
| `ScrapeIdFields.ts`      | `MaskedNumber` · `AccountIndex`                                          | Leumi's account display-id / query-id field names                                                                                                                                                      |
| `SharedWK.ts`            | `'סגירה'` close-popup text (ariaLabel + exactText)                       | dismiss Leumi's cookie-consent overlay so HOME can reach the login link                                                                                                                                |

To add a bank like this, see [Adding a new bank](../contributing/new-bank.md) — it walks through the same builder-and-Well-Known steps Leumi uses.

## Known quirks

- HOME dismisses Leumi's cookie-consent overlay (the `'סגירה'` close control added to `SharedWK`) before it can reach the login link.
- No OTP — plain `username`/`password` login; the pipeline is 100% generic via network-traffic discovery.
- Transactions arrive from Leumi's WCF endpoint `UC_SO_27_GetBusinessAccountTrx`; its rows carry the date as `DateUTC` and the per-txn reference as `ReferenceNumberLong` (see the Well-Known extensions above).
- BALANCE-RESOLVE is per-bank-account (`balanceKind: ACCOUNT`).
