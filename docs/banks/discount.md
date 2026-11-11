# Discount Bank

|                |                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Discount`                                                                                                                                                           |
| Engine         | **API-direct** (no browser): the bank's web login API and Titan gateway on `start.telebank.co.il`                                                                    |
| Credentials    | `id`, `password`, `num`                                                                                                                                              |
| OTP            | —                                                                                                                                                                    |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                                |
| Source         | [`Banks/Discount/DiscountPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Discount/DiscountPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  id: '123456789',
  password: 'mypassword',
  num: '12345',
});
```

## Known quirks

- Three-field login — the third `num` field is the Discount-specific account number.
- Balance is per-bank-account — Discount customers usually have one BA, but the hard-model balance step handles multi-BA accounts identically.
- The PayBox wallet uses Discount's infrastructure but ships as a separate api-direct bank — see [PayBox](paybox.md).

## Browserless login

`DISCOUNT_API_DIRECT_CALL` (`Registry/Config/PipelineBankConfigDiscount.ts`)
is the Telebank family login built for Discount's `ITelebankBrand`: bank
code `d`, routing cookie `cssName=discount`, login page `/login/` and id
prefixes `00001` / `0000`. `buildTelebankApiDirectCall`
(`PipelineBankConfigTelebankFamily.ts`, its steps from `telebankLoginSteps`
in `PipelineBankConfigTelebankFamilySteps.ts`) logs in the way the bank's
web app does, over plain HTTPS on `TELEBANK_ORIGIN`
(`https://start.telebank.co.il`), with no browser.
`DISCOUNT_TRANSPORT` (`buildTelebankHeadless`) registers its four paths,
selects Node's own `fetch` and keeps one cookie jar for `telebank.co.il`;
any redirect a step does not allow fails the run. The registry row is
`defineApiDirectBank`, so a run opens no browser.

| Step            | Call                                          | Sends                                                                            | Checks                                                                                                                                      |
| --------------- | --------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `prime`         | GET `/login/`                                 | the app's routing cookies (`cssName`, `language`, `t`, `caller`)                 | one `<app-root` app shell and no `csrfToken`, in at most 131 072 chars                                                                      |
| `encryptionKey` | POST `/Lobby/gatewayAPI/verification/getInfo` | the app context                                                                  | the RSA key at `GetVerificationInfo.Key`, at most 16 384 chars                                                                              |
| `logon`         | POST `/Lobby/gatewayAPI/login`                | the formatted `Uid`; `num` and `password` sealed with that key (RSA PKCS#1 v1.5) | a 302/303 only to `loginSuccessResponse`, followed as a GET; `Login.MI6` equal to the MD5 of `Uid`; `Login.Status`, when present, `SUCCESS` |
| `landing`       | GET `/apollo/retail3`                         | the `mi6`, `fte` and `newRetail` cookies                                         | at most one hop, only to `/apollo/retail3/`; an `<apollo-root` page                                                                         |

`Uid` is derived from `id` before any call: up to nine digits become
`00001` and the id padded to nine; ten digits starting with `9` become
`0000` and the id. Any other id fails as `GENERIC`
(`derivedCarry: uid unformattable`). `id` must be digits and `password` and
`num` Latin-1, or the run fails before the first call.

Every call carries `TELEBANK_STATIC_HEADERS`
(`Registry/Config/PipelineBankConfigTelebankFamilyConstants.ts`): the
library's user agent `TELEBANK_UA`, the origin, an empty `BusinessProcessID`,
and `Language`, `Site` and `UUID` read from the live `language`, `site` and
`tuuid` cookies (`HEBREW`, `retail` and empty when missing). The decoded
`XSRF-TOKEN` cookie rides as `X-XSRF-TOKEN`; an undecodable one fails the run
before the request. `prime` adds `telebankLoginHeaders` (a JSON accept, the
brand's `telebankLoginPage` as referer and an empty `AccountNumber`), the two
POSTs `telebankLoginPostHeaders` (the same with a JSON content type) and
`landing` `telebankDocumentHeaders` (an HTML accept and the same referer).

An `Error`, `error` or `actionRequired` holding a truthy scalar or a
non-empty array or object in the `getInfo` or `login` answer fails as
`GENERIC` (`<step> bank error`); so does an `MI6` mismatch. A `Status` other than
`SUCCESS` (`null`, empty or any other value) fails as `INVALID_PASSWORD`. The
config sets `omitBankText`, so no failure message carries the bank's own text.

## Hard-model post-auth

After login, `DISCOUNT_SHAPE` (`Banks/Discount/scrape/DiscountShape.ts`)
binds the shared Telebank group shape: `makeTelebankGroupShape`
(`Phases/ApiDirectScrape/TelebankGroup/TelebankGroupShape.ts`) takes an
`ITelebankGroupShapeArgs` with the bank's own step name and window stance
(`lowerBoundOnly`). The shape declares three GET reads on the Titan gateway,
`TITAN_API` (`/Titan/gatewayAPI` on `TELEBANK_ORIGIN`), sent over the login's
cookie jar:

| Read         | Call                                                                  | `accountnumber`  |
| ------------ | --------------------------------------------------------------------- | ---------------- |
| accounts     | GET `userAccountsData?FetchAccountsNickName=true&FirstTimeEntry=true` | empty            |
| balance      | GET `accountDetails/infoAndBalance/{AccountID}`                       | the account's id |
| transactions | GET `lastTransactions/transactions/{AccountID}/Date?…`                | the account's id |

Every read sends `titanHeaders` (`TelebankGroupShapeHelpers.ts`):
`TELEBANK_STATIC_HEADERS`, then `TELEBANK_TITAN_HEADERS` (a JSON accept and
the retail app as referer), then `accountnumber`. The shape's
`callAccountIdOf` puts the Titan `NewAccountInfo.AccountID` there, not the
`FormatAccountID` users see, which stays the account number in the result.

Every answer passes `checkTitanBody` (`TelebankGroupShapeCheck.ts`) before it is
read. Each refusal fails as `GENERIC` and never quotes the bank:

| Answer                                                                           | Refusal                         |
| -------------------------------------------------------------------------------- | ------------------------------- |
| not a JSON object                                                                | `titan answer not an object`    |
| `actionRequired` set to anything but null (checked first)                        | `titan answer action required`  |
| `Error` or `error` set to anything but null                                      | `titan answer error`            |
| `UserAccountsData.UserAccounts` missing, empty or not a list                     | `titan accounts unverified`     |
| an account id repeated, or not 1–128 letters, digits, `_` or `-`                 | `titan account ids invalid`     |
| more than 8 accounts                                                             | `titan accounts over budget`    |
| `CurrentAccountLastTransactions.OperationEntry` missing or not a list of objects | `titan transactions unverified` |

The driver gives the check no step, so the rules key on the container an
answer carries; an answer with neither passes. An accounts answer without
one reads as no accounts and fails the run at the phase's
`zeroAccountsGuard` floor; a transactions answer without one reads as no
entries. A balance answer has no rule of its own: `balanceExtract` reads
`AccountBalance`, then `AccountAvailableBalance`, then 0. Transactions send
only a start date
(`windowNarrowing: 'lowerBoundOnly'`). See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.
