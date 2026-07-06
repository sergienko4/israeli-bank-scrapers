# Bank Yahav

|                |                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Yahav`                                                                                                                                                  |
| Engine         | Browser (Pipeline) — TCS **BaNCS Digital** backend                                                                                                       |
| Credentials    | `num`, `nationalID`, `password`                                                                                                                          |
| OTP            | —                                                                                                                                                        |
| Phase chain    | INIT → HOME → LOGIN → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE (hard-model post-auth)                                                |
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
on the `digital.yahav.co.il` Angular SPA. After login, the **hard-model**
post-auth path (`.withBrowserApiDirect(YAHAV_SHAPE)`) issues Yahav's exact BaNCS
API calls directly — no generic network-traffic discovery. Its config entry
([`Registry/Config/PipelineBankConfig.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Registry/Config/PipelineBankConfig.ts))
is minimal:

| Key                | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| `urls.base`        | `https://www.yahav.co.il` — INIT navigates here; LOGIN reuses it         |
| `balanceKind`      | `ACCOUNT` — live balance resolved per bank-account by the hard-model step |
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
`Payload.Category` + shape. The hard-model shape (`YAHAV_SHAPE`) therefore
builds each request explicitly and extracts each response with dedicated,
BaNCS-shape-keyed helpers (not by bank id, so the other banks are provably
unaffected):

| Shape helper                          | Role                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Yahav/scrape/YahavShapeEnvelope.ts`  | builds the BaNCS `MessageEnvelope` (UTC timestamp, live `AppVer`, `SecToken`) shared by all three calls  |
| `Yahav/scrape/YahavAccountExtract.ts` | extracts the single current-DDA account (top-level IBAN + a `CURRENT` `BalanceList`)                     |
| `Bancs/BancsBalance.ts`               | selects the `CURRENT` balance from `BalanceList[]`                                                       |
| `Bancs/BancsNormalizer.ts`            | flattens each `Payload.DataEntity[]` txn (`OrigDt`/`TotalCurAmt`/…) to the shape                        |

The session secrets those requests carry — the `SecToken`, the CSRF header
(login-body `csrfTkn` replayed under its opaque request-header name), and the
SPA's custom XHR headers — are captured at **BIND-API-MEDIATOR** from the
login-boot request pool (`Phases/BindApiMediator/BindApiMediatorBancs*.ts`), not
rediscovered per call.

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
- No OTP — plain three-field login. The login flow is generic (WK-resolved
  visible text); post-auth uses the hard-model shape, not generic
  network-traffic discovery.
- Balance is per-bank-account (`balanceKind: ACCOUNT`), resolved by the
  hard-model balance step, which selects the `CURRENT` `BalType` from the
  account's `BalanceList[]`.
