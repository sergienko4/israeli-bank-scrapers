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

PayBox sends no `Authorization` header after login, so `/getUserHistory` identifies itself through an auth envelope in its request **body**. `buildAuthEnvelope()` (`scrape/PayBoxAuthEnvelope.ts`) builds it from the session context; `PAYBOX_AUTH_ENVELOPE_INTERNALS` exposes its two resolution steps for unit tests only.

`/sync` (balance) **must omit the envelope**. It answers HTTP 400 either way, but a rejected body carrying the live `access_token` makes PayBox invalidate the session — a forensic run recorded `/getUserHistory` returning `401 UNAUTHORIZED` 355 ms after a freshly minted token was sent to `/sync`. `balanceVars()` therefore returns `{}`, and `PayBoxScrapeBodyContract.test.ts` pins both halves: the envelope is required on every data step and forbidden on the balance call.

> **Note:** the balance step's `fallbackOnFail: 0` reports the 400 as a zero balance, so a degraded `/sync` is expected and is not by itself a failure. See [Response digest](../observability/response-digest.md) for reading what the server actually objected to.

