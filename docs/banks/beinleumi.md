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

Beinleumi logs in through the same HTTP calls its web client makes, with no
browser and no portal page read. Every call runs on the bank's online origin.
`BEINLEUMI_API_DIRECT_CALL` and `BEINLEUMI_TRANSPORT`
(`Registry/Config/PipelineBankConfigBeinleumi.ts`) are the FIBI-family login
built for one `IFibiBrand` record: the origin, the servlet's `bankId`, the
Transmit app id, the bank number and the device-memory provider.
`buildFibiApiDirectCall` and `buildFibiTransport`
(`Registry/Config/PipelineBankConfigFibiFamily.ts`) build both from the brand,
so a sibling bank of the family differs by its brand alone.

| Step             | Call                                     | Sends                                                                       | Keeps                                                          |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `encryptionKey`  | `POST` the key exchange                  | a fresh `secp256k1` public key                                              | the envelope key and session                                   |
| `login`          | `POST` the login                         | the user id and the brand's bank number, sealed                             | the session id; the login must offer the password method alone |
| `assertPassword` | `POST` the assertion                     | the password, sealed                                                        | the login token, or the one SMS target the bank offers         |
| `otpInit`        | `POST` the assertion                     | a request to send the code                                                  | the code's format; runs only when the code is yet to be sent   |
| `assertOtp`      | `POST` the assertion                     | the code from `otpCodeRetriever`, 4–10 digits of the length the bank stated | the login token; runs only when the bank asked for a code      |
| `logon`          | `POST` the entry form (`fibiServletUrl`) | the static form fields, the user and the token as `passwordEnc`             | —                                                              |
| `bootstrap`      | `POST` the SSO bootstrap                 | `{TPPName: 'shell'}`                                                        | the SSO code                                                   |
| `sessionToken`   | `GET` the authorization, with the code   | —                                                                           | the `authorization` header the scrape sends                    |

`fibiOpeningSteps`, `fibiAssertSteps`, `fibiLogonStep` and `fibiSsoSteps`
build these rows; the sealed request bodies are `fibiLoginBody`,
`FIBI_KEY_EXCHANGE_BODY`, `FIBI_PASSWORD_BODY`, `FIBI_OTP_TRIGGER_BODY` and
`FIBI_OTP_BODY` (`Registry/Config/PipelineBankConfigFibiFamilyBodies.ts`).

The `logon` form's fields are static — `isPaymentProc=false`, `KODSAFA=HE`,
`userLoginHome=Private`, `bankId=<brand>`, `showCaptcha=false`, `lang=HE` —
so the login no longer reads the page to learn them. The servlet accepts the
token without a preceding page read and answers `200` with the session
cookies; there is no `Location` to follow, and the SSO calls run from the same
cookie jar.

The answers are read the way the web SDK reads them, and anything else fails
closed. `FIBI_LOGIN_CLASSIFIER` accepts one pending action offering the
password method alone. `FIBI_AUTH_CLASSIFIER` accepts either a completed
login or one SMS channel with one target, its code numeric of a stated
length or of no stated format. `FIBI_OTP_TRIGGER_CLASSIFIER` keeps the format
the trigger answer restates, and `FIBI_OTP_RESULT_CLASSIFIER` accepts a
completed login only. A bank error on the password or the code fails as
`InvalidPassword` or `InvalidOtp`. A code of the wrong length fails before it
is sent.

The SSO calls are kept to the brand's origin. Each call sends `FIBI_UA`, which
names this library rather than a browser; the Transmit calls also send the
SDK's `FIBI_TS_CLIENT_VERSION` and `FIBI_TS_AUTHORIZATION`. The device the SDK
reports is this host's OS, Node.js version and time zone, with no location.

## Wire policy

`BEINLEUMI_TRANSPORT` maps each step to its path in `FIBI_PATHS` on the online
origin, keeps one cookie session over native fetch and refuses what the web
login never answers:

- any redirect;
- any `2xx` but `200` (`FIBI_STATUS_POLICY`);
- a login answer that is not `FIBI_HTML` (`FIBI_PAGE_ACCEPT` is what the
  servlet is asked for) or longer than `FIBI_PAGE_MAX_CHARS`, and an SSO answer
  longer than `FIBI_SSO_MAX_CHARS`;
- a body that is not strict UTF-8, except the `sessionToken` answer, whose
  body is never read.

The config sets `omitBankText`, so no failure message carries the bank's own
text. Browser options passed to `createScraper` are no longer supported; see the
[migration notes](../configuration.md#removed-browser-options).

The login never requests the portal HTML page that bot protection guards. The
`logon` post sends the ordinary form `Accept: text/html,application/xhtml+xml`,
and an HTTP 200 without the servlet's session cookies is not an authenticated
login. This removed the only HTML read from the login path.

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
kept, with a fresh `x-fibi-transaction-id`, `Accept: application/json` and
`FIBI_UA`. The bank answered these calls without `Origin` or `Referer`, so
neither is sent. The login's `sessionCarry` hands the scrape that one slot
(`authorization`) and nothing else. See
[api-direct-scrape](../phases/api-direct-scrape.md) for the phase contract.
