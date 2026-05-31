# Rejected fixture (phoneNumber: '+972' contradicts contract)

The example below shows the contradiction the canary catches:

```typescript
await scraper.scrape({
  email,
  password,
  phoneNumber: '+972000000000',
  otpCodeRetriever: async () => '123456',
});
```

A reader following this example would prepend a literal `+`, which the
mediator's `validateInternationalDigits` then rejects with a confusing
"phoneNumber must be digits only" failure.
