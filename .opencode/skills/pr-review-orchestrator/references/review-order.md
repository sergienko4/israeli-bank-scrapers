# Review order

| Step | Skill                    | Ask                                                             |
| ---- | ------------------------ | --------------------------------------------------------------- |
| 1    | `pr-review-context`      | What changed, why, and is the scope complete?                   |
| 2    | `pr-review-code`         | Does the change work, fail safely, and prove itself with tests? |
| 3    | `pr-review-architecture` | Is it in the right layer, with stable contracts and a rollout?  |
| 4    | `pr-review-security`     | What new trust boundary, secret, auth or injection path exists? |
| 5    | `pr-review-quality`      | Can an operator see it, and is it simple enough to maintain?    |

Checklists live in each skill. The stop rule and output contract live in the
orchestrator.
