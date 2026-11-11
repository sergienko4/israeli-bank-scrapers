# Bank Pagi

|                |                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompanyTypes` | `Pagi`                                                                                                                                               |
| Engine         | **API-direct** (no browser): the bank's web login API on `online.pagi.co.il`                                                                         |
| Credentials    | `username`, `password`; an `otpCodeRetriever` callback, in the options or the credentials                                                            |
| OTP            | When the bank asks; a remembered device may skip it ([warm start](#warm-start)), so keep `otpCodeRetriever` set                                      |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                |
| Source         | [`Banks/Pagi/PagiPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Pagi/PagiPipeline.ts) |

## Quick example

```typescript
const scraper = createScraper({
  companyId: CompanyTypes.Pagi,
  startDate: new Date('2024-01-01'),
  otpCodeRetriever: async phoneHint => await myInbox.getSmsCode(phoneHint),
});

const result = await scraper.scrape({
  username: 'myuser',
  password: 'mypassword',
});
```

`otpCodeRetriever` may sit in the options, as above, or in the credentials; it
is called only when the bank asks for a code.

## Login

Pagi is a brand of the Beinleumi group and logs in the way
[Beinleumi](beinleumi.md#login) does, with no browser, on its own online
origin. `PAGI_API_DIRECT_CALL` and `PAGI_TRANSPORT`
(`Registry/Config/PipelineBankConfigPagi.ts`) are the FIBI-family login
built for Pagi's `IFibiBrand`:

| Brand field | Pagi                        |
| ----------- | --------------------------- |
| `origin`    | `https://online.pagi.co.il` |
| `portalId`  | `PAGIPORTAL`                |
| `aid`       | `rest_app_052`              |
| `bankNum`   | `052`                       |
| `provider`  | `pagi-web`                  |

Every step, answer check and wire rule is Beinleumi's, bound to this origin;
see the Beinleumi [login](beinleumi.md#login) and
[wire policy](beinleumi.md#wire-policy). Browser options passed to
`createScraper` are no longer supported; see the
[migration notes](../configuration.md#removed-browser-options).

## Warm start

Pagi keeps the device the bank names as
[device memory](../phases/api-direct-call/auth.md#device-memory), as
[Beinleumi](beinleumi.md#warm-start) does, under provider `pagi-web`,
bound to `username`. Pass `onPersistentAuthStateUpdate` on the first run and
the stored `persistentAuthState` with it on later runs; the bank decides
whether to ask for a code, so keep `otpCodeRetriever` set. A state stored for
another bank of the group names another provider and fails the run before any
request.

The state is base64url JSON naming the provider, the `username` in lower
case and the device id. It holds no password, token or key, but it is
encoded, not encrypted, so store it as a secret.

## Known quirks

- Mocked tests cover the Pagi login with its own brand values; no
  live Pagi run has been recorded yet.
- Balance plan is single bank-account.

## Hard-model post-auth

After login, the `PAGI_SHAPE` `IApiDirectScrapeShape` (helpers under
`Banks/Pagi/scrape/`) declares each endpoint on the online origin. The
calls are sent as Beinleumi's are, over the login's cookie session with the
`authorization` and landing URL its `sessionCarry` keeps; see
[Beinleumi hard-model post-auth](beinleumi.md#hard-model-post-auth) and
[api-direct-scrape](../phases/api-direct-scrape.md).
