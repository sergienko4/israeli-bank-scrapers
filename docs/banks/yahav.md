# Bank Yahav

|                |                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Yahav`                                                                                                                                                  |
| Engine         | Browser (Pipeline) — TCS **BaNCS Digital** backend                                                                                                       |
| Credentials    | `num`, `nationalID`, `password`                                                                                                                          |
| OTP            | —                                                                                                                                                        |
| Phase chain    | INIT → HOME → LOGIN → AUTH-DISCOVERY → ACCOUNT-RESOLVE → DASHBOARD → SCRAPE → BALANCE-RESOLVE → TERMINATE                                                |
| Source         | [`Banks/Yahav/YahavPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Yahav/YahavPipeline.ts) |

## Quick example

```typescript
import { CompanyTypes, createScraper } from '@sergienko4/israeli-bank-scrapers';

const scraper = createScraper({
  companyId: CompanyTypes.Yahav,
  startDate: new Date('2024-01-01'),
});

const result = await scraper.scrape({
  num: 'myusercode', // Yahav "קוד משתמש"
  nationalID: '123456789', // "תעודת זהות"
  password: 'mypassword',
});
```

For backward compatibility the legacy key `username` is still accepted as an
alias for `num`, so `scrape({ username, nationalID, password })` keeps working.

## Pipeline specifics

Yahav is a **real-browser** Pipeline bank backed by **TCS BaNCS Digital**.
Camoufox drives `https://www.yahav.co.il`, follows the SiteMinder login
(credentials entered in a cross-origin iframe at `login.yahav.co.il`), and lands
on the `digital.yahav.co.il` Angular SPA. Everything past login is
network-traffic discovery — no imperative scraping code. Its config entry
([`Registry/Config/PipelineBankConfig.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Registry/Config/PipelineBankConfig.ts))
is minimal:

| Key                | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| `urls.base`        | `https://www.yahav.co.il` — INIT navigates here; LOGIN reuses it         |
| `balanceKind`      | `ACCOUNT` — live balance resolved per bank-account in BALANCE-RESOLVE    |
| `authStrategyKind` | `SESSION_COOKIE` — the session is carried by cookies, not a bearer token |

**Login is three-field and WK-resolved.** `YAHAV_LOGIN` ships **empty selector
arrays** (`num`, `nationalID`, `password`) — `SelectorResolver` matches them from
the generic Well-Known login candidates, per the repo's ZERO-CSS-selectors rule.
The builder wires only `.withBrowser()` + `.withDeclarativeLogin(YAHAV_LOGIN)`,
so there is no PRE-LOGIN and no OTP. Because Yahav's national-ID input
carries its label **only in `aria-label`** (`"תעודת זהות (9 ספרות)"`) with an
empty placeholder, the migration **added the missing visible-text matcher to
the generic `LoginWK.nationalId` slot** — a `labelText`/`ariaLabel` value of
`"תעודת זהות"`, which Playwright `getByLabel` substring-matches against the
field's accessible name (zero CSS). The shared WK is extended, never a
bank-specific selector in the config.

**BaNCS multiplexes every data call through one URL.** Unlike a REST bank, BaNCS
serves accounts, balances, and transactions from the **same** endpoint
`POST /BaNCSDigitalApp/account`, differentiated by the request-body
`Payload.Category` + shape. The migration therefore added **default-deny,
fail-closed shape recognizers** (keyed by BaNCS _shape_, not by bank id, so the
other banks are provably unaffected):

| Recognizer / normalizer      | Recognizes                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------- |
| `Bancs/BancsAuthResponse.ts` | the authed `/account` 200-JSON envelope (auth-discovery corroboration)           |
| `Bancs/BancsTxnRequest.ts`   | a txn capture: `Category` includes `CURRENT_ACCOUNT` **and** an `OrigDt` filter  |
| `Bancs/BancsAccount.ts`      | the single current-DDA account (top-level IBAN + a `CURRENT` `BalanceList`)      |
| `Bancs/BancsBalance.ts`      | the `CURRENT` balance from `BalanceList[]`                                       |
| `Bancs/BancsNormalizer.ts`   | flattens each `Payload.DataEntity[]` txn (`OrigDt`/`TotalCurAmt`/…) to the shape |

The Imperva error page (`לא ניתן להשלים בקשה`, served as HTML with HTTP 200) is
rejected by three independent layers (content-type guard, `Payload.DataEntity`
envelope guard, and the capture-layer `JSON.parse`), so it can never
false-positive as authed data.

## Known quirks

- **Aria-label-only login fields.** The national-ID input has an empty
  placeholder, with its label only in `aria-label="תעודת זהות (9 ספרות)"` — it
  is matched by the visible-text value `"תעודת זהות"` in `LoginWK`, which
  Playwright `getByLabel` substring-matches (no `name`/`id` CSS coupling).
- **Cross-origin login iframe.** Credentials are entered in an iframe on
  `login.yahav.co.il`; the SiteMinder redirect chain
  (`#/authentication?SMAUTHREASON=27`) lands on `digital.yahav.co.il`.
- **Imperva WAF on the txn replay.** The programmatic `POST /account` txn replay
  must carry the SPA's fresh security headers (`x-xsrf-token`, `bd_ident_key`,
  `content-type`); these are forwarded from the captured BaNCS request, else the
  bank returns the Imperva HTML block page instead of txn JSON.
- **Date range in the request body.** Transactions carry a
  `Payload.Filters[].Filters[]` pair of `OrigDt {Day,Month,Year}` bounds
  (`GREATERTHANOREQUAL` from / `LESSTHANOREQUAL` to) substituted from the user's
  `startDate`.
- No OTP — plain three-field login; the pipeline is 100% generic via
  network-traffic discovery.
- BALANCE-RESOLVE is per-bank-account (`balanceKind: ACCOUNT`), selecting the
  `CURRENT` `BalType` from the account's `BalanceList[]`.
