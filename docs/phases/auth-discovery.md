# AUTH-DISCOVERY

Capture the post-login auth token, API origin, cookies, and any session ids by observing the live network the page is producing. Separates the credential exchange from the dashboard hand-off so post-auth signals are observable, redactable, and testable.

| | |
|---|---|
| **Always-on?** | Yes (`ifBrowser`) |
| **Owner slot** | `authDiscovery: Option<IAuthDiscovery>`, `api: Option<IApiFetchContext>` |
| **Source** | [`AuthDiscoveryPhase.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/AuthDiscovery/AuthDiscoveryPhase.ts) + [`AuthDiscovery.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Network/AuthDiscovery.ts) |

## Sub-step contract

| Hook | What it does |
|---|---|
| `.pre` | Read the captured network pool produced since LOGIN. |
| `.action` | Run `discoverAuthToken()` — scan request headers for `Authorization`, cookies for session ids, response bodies for `accessToken` / `csrfToken` / `bearer`. |
| `.post` | Validate at least one auth signal was found. |
| `.final` | Commit `authDiscovery` + build `IApiFetchContext` (the `api.fetchPost` / `fetchGet` surface that BALANCE-RESOLVE and SCRAPE use). |

## What's in IApiFetchContext

```typescript
interface IApiFetchContext {
  readonly fetchPost: <T>(url: string, body: Record<string, string | object>) => Promise<Procedure<T>>;
  readonly fetchGet: <T>(url: string) => Promise<Procedure<T>>;
  readonly transactionsUrl: string | false;   // discovered TXN endpoint, or false if unknown
  readonly balanceUrl: string | false;        // discovered balance endpoint
  readonly pendingUrl: string | false;        // discovered pending-txns endpoint
}
```

`fetchPost` / `fetchGet` auto-inject the discovered auth headers + cookies. Banks never assemble headers themselves; they just declare URL + body.

## Failure modes

`GENERIC "no auth signal discovered"` — the pool didn't carry any post-login token. Typically a sign that LOGIN didn't actually authenticate (race condition, slow bank, or a permissions wall).
