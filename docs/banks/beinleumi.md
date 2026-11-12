# Beinleumi (FIBI)

|                |                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CompanyTypes` | `Beinleumi`                                                                                                                                                              |
| Engine         | **API-direct** (no browser): the bank's web login API on `online.fibi.co.il`                                                                                             |
| Credentials    | `username`, `password`; an `otpCodeRetriever` callback, in the options or the credentials                                                                                |
| OTP            | When the bank asks; a remembered device may skip it ([warm start](#warm-start)), so keep `otpCodeRetriever` set                                                          |
| Phase chain    | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md)                                                                    |
| Source         | [`Banks/Beinleumi/BeinleumiPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Beinleumi/BeinleumiPipeline.ts) |

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

`otpCodeRetriever` may sit in the options, as above, or in the credentials; it
is called only when the bank asks for a code.

## Login

Beinleumi logs in the way its web login page does, with no browser. Every call
runs on the bank's online origin. `BEINLEUMI_API_DIRECT_CALL` and
`BEINLEUMI_TRANSPORT` (`Registry/Config/PipelineBankConfigBeinleumi.ts`) are the
FIBI-family login built for one `IFibiBrand` record: the origin, the entry
page's `bankId`, the Transmit app id, the bank number and the device-memory
provider. `buildFibiApiDirectCall` and `buildFibiHeadless`
(`Registry/Config/PipelineBankConfigFibiFamily.ts`) build both from the brand,
so a sibling bank of the family differs by its brand alone.

| Step             | Call                                     | Sends                                                                       | Keeps                                                                                                     |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `prime`          | `GET` the entry page (`fibiEntryUrl`)    | —                                                                           | the login form, the bank number (it must be the brand's) and the client address, each stated exactly once |
| `encryptionKey`  | `POST` the key exchange                  | a fresh `secp256k1` public key                                              | the envelope key and session                                                                              |
| `login`          | `POST` the login                         | the user id, sealed                                                         | the session id; the login must offer the password method alone                                            |
| `assertPassword` | `POST` the assertion                     | the password, sealed                                                        | the login token, or the one SMS target the bank offers                                                    |
| `otpInit`        | `POST` the assertion                     | a request to send the code                                                  | the code's format; runs only when the code is yet to be sent                                              |
| `assertOtp`      | `POST` the assertion                     | the code from `otpCodeRetriever`, 4–10 digits of the length the bank stated | the login token; runs only when the bank asked for a code                                                 |
| `logon`          | `POST` the entry form (`fibiServletUrl`) | the form, its password replaced by the token                                | the portal hand-off URL the page names                                                                    |
| `landing`        | `GET` the hand-off                       | —                                                                           | the landing URL, after at most 3 redirects                                                                |
| `bootstrap`      | `POST` the SSO bootstrap                 | `{TPPName: 'shell'}`                                                        | the SSO code                                                                                              |
| `sessionToken`   | `GET` the authorization, with the code   | —                                                                           | the `authorization` header the scrape sends                                                               |

`fibiPrimeStep`, `fibiOpeningSteps`, `fibiAssertSteps`, `fibiHandoffSteps`
and `fibiSsoSteps` build these rows; the sealed request bodies are
`FIBI_KEY_EXCHANGE_BODY`, `FIBI_LOGIN_BODY`, `FIBI_PASSWORD_BODY`,
`FIBI_OTP_TRIGGER_BODY` and `FIBI_OTP_BODY`
(`Registry/Config/PipelineBankConfigFibiFamilyBodies.ts`).

The answers are read the way the web SDK reads them, and anything else fails
closed. `FIBI_LOGIN_CLASSIFIER` accepts one pending action offering the
password method alone. `FIBI_AUTH_CLASSIFIER` accepts either a completed
login or one SMS channel with one target, its code numeric of a stated
length or of no stated format. `FIBI_OTP_TRIGGER_CLASSIFIER` keeps the format
the trigger answer restates, and `FIBI_OTP_RESULT_CLASSIFIER` accepts a
completed login only. A bank error on the password or the code fails as
`InvalidPassword` or `InvalidOtp`. A code of the wrong length fails before it
is sent.

The hand-off, every landing hop and the SSO calls are kept to the brand's
origin: `fibiPortalRule` refuses any other origin and any path naming one of
`FIBI_DENIED_PATHS` (logout, password change or recovery). Each call sends
`FIBI_UA`, which names this library rather than a browser; the Transmit calls
also send the SDK's `FIBI_TS_CLIENT_VERSION` and `FIBI_TS_AUTHORIZATION`. The
device the SDK reports is this host's OS, Node.js version and time zone, with
no location.

## Wire policy

`BEINLEUMI_TRANSPORT` maps each step to its path in `FIBI_PATHS` on the online
origin, keeps one cookie session over native fetch and refuses what the web
login never answers:

- any redirect, except the `landing` hops above;
- any `2xx` but `200` (`FIBI_STATUS_POLICY`);
- a login page that is not `FIBI_HTML` (`FIBI_PAGE_ACCEPT` is what the pages
  are asked for) or longer than `FIBI_PAGE_MAX_CHARS`, and an SSO answer
  longer than `FIBI_SSO_MAX_CHARS`;
- a body that is not strict UTF-8, except the `sessionToken` answer, whose
  body is never read.

The config sets `omitBankText`, so no failure message carries the bank's own
text. Browser options passed to `createScraper` are no longer supported; see the
[migration notes](../configuration.md#removed-browser-options).

The entry GET uses the ordinary web caller's
`Accept: text/html,application/xhtml+xml`, like the later portal pages, while
its response policy still requires HTML and the real bank/IP/form context.
An HTTP 200 without those values is not an authenticated or usable login page.

## Warm start

The bank remembers the device it names during a login, and a device it knows
may log in without an SMS code. The bank decides, and may still ask for one,
so keep `otpCodeRetriever` set on every run. Beinleumi keeps
that device as [device memory](../phases/api-direct-call/auth.md#device-memory)
(provider `beinleumi-web`, bound to `username`):

- **First run.** Pass `onPersistentAuthStateUpdate` and no
  `persistentAuthState`. The login runs cold, with an SMS code if the bank
  asks, and the callback receives the state once, before the scrape.
- **Later runs.** Pass the stored `persistentAuthState` and the callback. The
  stored device id is sent on the key exchange, the login and the assertions;
  a different id in an answer does not replace it, and nothing is published.

The state is base64url JSON naming the provider, the `username` in lower
case and the device id. It holds no password, token or key, but it is
encoded, not encrypted, so store it as a secret.

## Known quirks

- Beinleumi is the parent of the Beinleumi group. [Massad](massad.md), [Otsar Hahayal](otsar-hahayal.md) and [Pagi](pagi.md) log in the same way with their own brands.
- Balance endpoint shape: `currentBalance ?? withdrawableBalance ?? 0` per account — see [`FibiGroupShapeHelpers.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectScrape/FibiGroup/FibiGroupShapeHelpers.ts).

## Hard-model post-auth

After login, the `BEINLEUMI_SHAPE` `IApiDirectScrapeShape`
(account-list, balance, and transactions helpers under `Banks/Beinleumi/scrape/`:
`extractAccounts`, `balanceExtract` / `balanceUrl`, `txnsVars` /
`txnsExtractPage`) declares each endpoint. Each call goes over the login's
cookie session on the online origin and sends the `authorization` the login
kept, with a fresh `x-fibi-transaction-id`, and what the portal page sends:
`Accept: application/json`, `FIBI_UA`, and the landing URL the login kept as
`Referer`, with its origin as `Origin`. The login's `sessionCarry` hands the
scrape these two slots (`authorization`, `landingUrl`) and nothing else. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.
