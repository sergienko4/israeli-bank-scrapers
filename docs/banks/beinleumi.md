# Beinleumi (FIBI)

| | |
|---|---|
| `CompanyTypes` | `Beinleumi` |
| Engine | Browser (Pipeline) |
| Credentials | `username`, `password` (plus `otpCodeRetriever` callback in options) |
| OTP | Required |
| Phase chain | INIT → HOME → LOGIN → **OTP-TRIGGER → OTP-FILL** → BIND-API-MEDIATOR → API-DIRECT-SCRAPE → TERMINATE |
| Source | [`Banks/Beinleumi/BeinleumiPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Beinleumi/BeinleumiPipeline.ts) |

## Quick example

```typescript
const scraper = createScraper({
  companyId: CompanyTypes.Beinleumi,
  startDate: new Date('2024-01-01'),
  otpCodeRetriever: async phoneHint => await myInbox.getSmsCode(phoneHint),
});

const result = await scraper.scrape({
  username: 'myuser',
  password: 'mypassword',
});
```

## Known quirks

- Beinleumi is the parent of the Beinleumi group: same login flow used by Massad, Otsar Hahayal, Pagi.
- Balance endpoint shape: `(withdrawable + current)` per account — see [`beinleumi/balance-resolve/last-good.json`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Tests/Unit/Pipeline/CrossValidation/Phases/Fixtures/beinleumi/balance-resolve/last-good.json) for the captured response shape.

## Hard-model post-auth

After login, Beinleumi uses the hard-model post-auth path
(`withBrowserApiDirect`): the exact API calls are issued directly through the
live login page instead of the generic AUTH-DISCOVERY / ACCOUNT-RESOLVE /
DASHBOARD / SCRAPE / BALANCE-RESOLVE chain. The bank's `IApiDirectScrapeShape`
(account-list, balance, and transactions helpers under `Banks/Beinleumi/scrape/`:
`extractAccounts`, `balanceExtract` / `balanceUrl`, `txnsVars` /
`txnsExtractPage`) declares each endpoint. AUTH-DISCOVERY performs the
cross-origin post-login nav (config `postLoginNav`) to the appsng SPA shell
(`/appsng/Resources/PortalNG/shell/#/accountSummary`) — FIBI logs in on
`www.fibi.co.il` but its data API lives on `online.fibi.co.il`, so this nav
mints the online-origin session before the cookie-authed fetches run (without
it they raise `NetworkError` on the blank `/wps/` portal shell). See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.

