# Mercantile Bank

|                |                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Mercantile`                                                                                                                                                                 |
| Engine         | **API-direct** (no browser): the bank's web login API and Titan gateway on `start.telebank.co.il`                                                                            |
| Credentials    | `id`, `password`, `num`                                                                                                                                                      |
| OTP            | —                                                                                                                                                                            |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                                        |
| Source         | [`Banks/Mercantile/MercantilePipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Mercantile/MercantilePipeline.ts) |

## Quick example

```typescript
const scraper = createScraper({
  companyId: CompanyTypes.Mercantile,
  startDate: new Date('2024-01-01'),
});

const result = await scraper.scrape({
  id: '123456789',
  password: 'mypassword',
  num: '12345',
});
```

## Login

Mercantile is a brand of the Discount group and logs in the way
[Discount](discount.md#browserless-login) does, with no browser, on the
shared `start.telebank.co.il` origin. `MERCANTILE_API_DIRECT_CALL` and
`MERCANTILE_HEADLESS` (`Registry/Config/PipelineBankConfigMercantile.ts`) are
the Telebank family login built for Mercantile's `ITelebankBrand`:

| Brand field      | Mercantile       |
| ---------------- | ---------------- |
| `bankCode`       | `m`              |
| `cssName`        | `merkantil`      |
| `loginPath`      | `/login/?bank=m` |
| `shortUidPrefix` | `00011`          |
| `longUidPrefix`  | `0001`           |

So the login page is `/login/?bank=m`, which every login call also names as
its referer; the key request and the login name bank `m`; and `Uid` is
`00011` and the id padded to nine digits, or `0001` and a ten-digit id
starting with `9`. Every step, answer check and wire rule is Discount's; see
the Discount [login](discount.md#browserless-login). Browser options passed to
`createScraper` are no longer supported; see the
[migration notes](../configuration.md#removed-browser-options).

## Hard-model post-auth

After login, `MERCANTILE_SHAPE` (`Banks/Mercantile/scrape/MercantileShape.ts`)
binds the shared Telebank group shape, `makeTelebankGroupShape`, under its own
step name `MercantileScrape` and window stance (`lowerBoundOnly`). Mercantile
reads the same Titan gateway as Discount, with the same reads, headers and
answer checks; see the Discount
[hard-model post-auth](discount.md#hard-model-post-auth) and
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.

## Known quirks

- Mocked tests cover the Mercantile login with its own brand values; no live
  Mercantile run has been recorded yet.
- The `?bank=m` query on the login page and referer is the configured entry to
  Mercantile's login, checked only against the mocked bank so far; if the bank
  answers it with another page, the run fails as `GENERIC` rather than logging
  in elsewhere.
- Balance is per bank account (`balanceKind: 'account'`).
