# Committed bank fixtures

PII-redacted response fixtures that unit tests replay offline. The
browser-driven integration harness (static-HTML and mirror-origin modes)
is gone: every registered bank is API-direct, so there is no login DOM to
drive.

## Layout

```
src/Tests/Integration/
├── fixtures/banks/<bankId>/   # committed, redacted API responses
├── Helpers/FixtureRoot.ts     # resolves a bank's fixture directory
└── Tools/PiiRedactor.ts       # redacts a capture before it is committed
```

## Consumers

- `src/Tests/Unit/Integration/Banks/Leumi/Leumi.contractExtraction.test.ts`
- `src/Tests/Unit/Integration/Banks/Mizrahi/Mizrahi.contractExtraction.test.ts`
- `src/Tests/Unit/Pipeline/Banks/Mizrahi/MizrahiBusFactory.ts`

## Adding a fixture

1. Capture the response against the real bank.
2. Redact it with `Tools/PiiRedactor.ts` before it touches disk.
3. Commit it under `fixtures/banks/<bankId>/` and replay it from a unit test.

Never commit an unredacted capture.
