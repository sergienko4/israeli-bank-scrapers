# Pepper (by Bank Leumi)

| | |
|---|---|
| `CompanyTypes` | `Pepper` |
| Engine | **API-direct** (no browser) |
| Credentials | `phoneNumber`, `password`, `otpCodeRetriever` |
| OTP | Required |
| Phase chain | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md) |
| Phone format | `international-flat` (`972000000000`) |
| Source | [`Banks/Pepper/PepperPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Banks/Pepper/PepperPipeline.ts) |

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
