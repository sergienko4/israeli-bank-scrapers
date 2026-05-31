# Accepted fixture (digits-only phoneNumber)

The example below matches the documented contract: no `+`, no dashes.

```typescript
await scraper.scrape({
  email,
  password,
  phoneNumber: '972000000000',
  otpCodeRetriever: async () => '123456',
});
```

Mentioning `+972` in prose is fine — only the assignment pattern with
trailing digits inside a code example is rejected.
