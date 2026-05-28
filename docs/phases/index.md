# Phases

> **Who this is for:** developers wiring a new bank, debugging a phase failure, or auditing the typed contract between phases.

Every phase implements [`BasePhase`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/BasePhase.ts) and owns four sub-step hooks: `pre`, `action`, `post`, `final`. The `PipelineExecutor` drives them in order and threads an immutable `IPipelineContext` snapshot between phases.

## Browser banks — 12 phases

| Slot | Phase | Always-on? | One-line role |
|---|---|---|---|
| 1 | [INIT](init.md) | ✅ | Launch Camoufox, build context, navigate to bank URL |
| 2 | [HOME](home.md) | ✅ | Landing-page discovery, signal login readiness |
| 3 | [PRE-LOGIN](pre-login.md) | ⚙️ | "Show login" toggle (Amex, Isracard, Max, VisaCal) |
| 4 | [LOGIN](login.md) | ✅ | 7-strategy `SelectorResolver` + declarative `LoginConfig` |
| 5 | [OTP-TRIGGER](otp-trigger.md) | ⚙️ | Ask bank to dispatch SMS |
| 6 | [OTP-FILL](otp-fill.md) | ⚙️ | Fill the code from `otpCodeRetriever` |
| 7 | [AUTH-DISCOVERY](auth-discovery.md) | ✅ | Capture post-login auth token + API origin |
| 8 | [ACCOUNT-RESOLVE](account-resolve.md) | ✅ | Discover account/card list + billing-cycle catalog |
| 9 | [DASHBOARD](dashboard.md) | ✅ | Pivot to dashboard, prime network capture |
| 10 | [SCRAPE](scrape.md) | ✅ | Per-account transaction walk; emit identities + balance template |
| 11 | [BALANCE-RESOLVE](balance-resolve.md) | ✅ | **v6** — owns every live balance fetch + per-card extraction |
| 12 | [TERMINATE](terminate.md) | ✅ | Close browser, finalise result |

## API-direct banks — 2 phases

| Phase | Replaces (browser side) | One-line role |
|---|---|---|
| [API-DIRECT-CALL](api-direct-call.md) | INIT → HOME → … → OTP-FILL | Login + OTP via JSON API |
| [API-DIRECT-SCRAPE](api-direct-scrape.md) | SCRAPE + BALANCE-RESOLVE | Shape-driven walk; `.final` emits `ctx.balanceResolution` |

## Sub-step contract template

```mermaid
sequenceDiagram
    participant Exec as PipelineExecutor
    participant Phase as <Phase>
    Exec->>Phase: .pre(prevCtx, currCtx)
    Phase-->>Exec: Procedure<IPipelineContext>
    Exec->>Phase: .action(sealedCtx)
    Phase-->>Exec: Procedure<IActionContext>
    Exec->>Phase: .post(prevCtx, currCtx)
    Phase-->>Exec: Procedure<IPipelineContext>
    Exec->>Phase: .final(prevCtx, currCtx)
    Phase-->>Exec: Procedure<IPipelineContext>
```

| Hook | Owns | Cannot |
|---|---|---|
| `.pre` | Read shared slots, plan the action | Modify slots outside the phase's declared scope |
| `.action` | Execute the work; sealed action-context — no mediator, no network discovery | Reach outside `IActionContext`; mutate prior slots |
| `.post` | Validate, partition, hard-fail on universal failure | Re-run the action |
| `.final` | Commit one new slot to `IPipelineContext` | Touch other phases' slots |

Failure at any sub-step returns `Procedure fail` — the executor records `errorType` + `errorMessage` and the run terminates cleanly through the rest of the chain's `.final` hooks (no half-finished state).
