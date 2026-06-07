# Mode B HAR fixtures — recording root

This directory stores per-bank Playwright HAR recordings + PII-redacted
sidecar JSON used by the Mode B mirror simulator.

```
mirrors/banks/
  <bank>/
    01-init.har
    02-pre-login.har
    03-login.har
    04-otp-trigger.har
    05-otp-fill.har
    06-auth-discovery.har
    07-account-resolve.har
    08-dashboard.har
    09-scrape.har
    10-terminate.har
    phase-map.json       # entries[i] → IntegrationPhase
```

**No HAR captures are committed yet.** See
`../Simulator/README.md` for the operator workflow that fills this tree.
