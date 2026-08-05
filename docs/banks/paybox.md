# PayBox (by Discount Bank)

| | |
|---|---|
| `CompanyTypes` | `PayBox` |
| Engine | **API-direct** (no browser) |
| Credentials | `phoneNumber`, `otpCodeRetriever` (plus optional `otpLongTermToken`) |
| OTP | Required (cached long-term token supported) |
| Phase chain | [API-DIRECT-CALL](../phases/api-direct-call.md) → [API-DIRECT-SCRAPE](../phases/api-direct-scrape.md) |
| Phone format | `international-dash` (`972-000000000`) |
| Source | [`Banks/PayBox/PayBoxPipeline.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/PayBox/PayBoxPipeline.ts) |

## Quick example

```typescript
const result = await scraper.scrape({
  phoneNumber: '972-000000000',                      // international-dash (with -)
  otpCodeRetriever: async () => await myInbox.getCode(),
});

// Save result.persistentOtpToken — pass as otpLongTermToken on next run to skip SMS
```

## Known quirks

- Uses **symmetric (AES-CBC-PKCS7) signing** with the signature written into the request body at an RFC-6901 pointer.
- The `cryptoField` pre-hook encrypts the OTP into `/pin` with a fresh IV at `/pinIv`.
- Deterministic `sha256-prefix-16` bootstrap: PayBox binds its long-term JWT to a phone-derived `deviceId16Hex` so the caller doesn't have to persist a device id.
- v8.4.x added a cold-path unblock when no `PAYBOX_OTP_LONG_TERM` cache exists.

## Post-login auth envelope

Every PayBox call made **after** login carries an auth envelope in its request **body** — PayBox does not use an `Authorization` header for these. `buildAuthEnvelope()` (`scrape/PayBoxAuthEnvelope.ts`) builds it from the session context so `/sync` and `/getUserHistory` cannot drift apart; `PAYBOX_AUTH_ENVELOPE_INTERNALS` exposes its two resolution steps for unit tests only.

A call that omits the envelope is malformed by contract. `/sync` shipped without one for some time, which is why `PayBoxScrapeBodyContract.test.ts` now asserts the invariant over *every* post-login URL tag rather than any single call — a body-level contract is not something a URL-tag-keyed stub can catch.

> **Note:** sending the envelope does **not** by itself make `/sync` return 200 — a live run with a correctly-formed envelope still returned HTTP 400. Treat the envelope as a precondition, not a cure. See [Response digest](../observability/response-digest.md) for reading what the server actually objected to.

