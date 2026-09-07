# Pepper (by Bank Leumi)

| | |
|---|---|
| `CompanyTypes` | `Pepper` |
| Engine | **API-direct** (no browser) |
| Credentials | `phoneNumber`, `password`, `otpCodeRetriever` |
| OTP | Required |
| Phase chain | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md) |
| Phone format | `international-flat` (`972000000000`) |
| Source | [`Banks/Pepper/PepperPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Pepper/PepperPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  phoneNumber: '972000000000',
  password: 'mypassword',
  otpCodeRetriever: async () => await myInbox.getCode(),
});
```

## Known quirks

- Uses **asymmetric (ECDSA-P256 / RSA-2048) signing** with the signature attached as a request header.
- REST API throughout (no GraphQL) — `/transactions` + `/balance` endpoints.
- Pepper is on the Headless mediator path — its `PipelineDescriptor` is composed via the fluent `PipelineBuilder` rather than the declarative literal style.
- Only **current accounts** are scrapeable; every other product the profile holds is skipped at discovery (see below).

## Unsupported account products

Pepper's `oshTransactionsNew` resolver serves current accounts only. Asked for
any other product it answers HTTP `400` inside a GraphQL `errors` array, while
the HTTP transport itself still reports `200`. Because the account walk
short-circuits on the first failure, a single foreign-currency or securities
product used to discard the **entire** scrape — the caller got nothing, not
even the current account that would have succeeded ([issue #550]).

Products are therefore filtered at discovery by `isSupportedAccount`, so an
unsupported one is never requested at all.

`PEPPER_SUPPORTED_ACCOUNT_CATEGORIES` is deliberately an **allow-list**, not a
deny-list of the reported `Foreign` / `SecuritiesAccount` values: `Ils` is the
only category confirmed against a live production account, so an unrecognised
future category is excluded rather than assumed serviceable.

The inverse risk — silently dropping an account that holds real money — is
handled by treating a product with **no usable category** as supported:
absent, `null`, and blank values are all retained, so a schema change fails
loudly at the resolver instead of vanishing. Only a non-blank *unrecognised*
category is excluded, and the allow-list comparison stays exact so a padded
near-miss such as `' Ils '` is never normalised into a supported value.

Filtering is observable rather than silent. `countDiscovered` reports how many
products the payload declared, and when any were excluded the phase emits one
`ACCOUNTS_FILTERED_LOG` line carrying counts only — no account identifiers, no
balances.

## Balance is truthful, never a fabricated zero

Pepper's balance step declares `fallbackOnFail: BALANCE_UNKNOWN`. A rejected
balance fetch therefore degrades the run instead of failing it, but the
resulting account **omits the `balance` key entirely** rather than reporting
`0`. `ITransactionsAccount.balance` is optional, so leaving it out is the only
truthful way to say "not known" — a zero would be a number the bank never sent
and reads as an empty account.

[issue #550]: https://github.com/sergienko4/israeli-bank-scrapers/issues/550
