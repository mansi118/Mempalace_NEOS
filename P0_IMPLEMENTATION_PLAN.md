# P0 Implementation Plan — From Critique to Ship

**Goal:** close every gap the ultrathink critique identified. Each item is scoped to a single commit that ships something preventing a failure we've seen or can reason about.

**Dependency:** P0.1 blocks production recovery; the rest run in parallel.

---

## Execution order

| # | Item | Blocks on | Commit |
|---|---|---|---|
| P0.1 | Restore embeddings (fresh Bedrock token or OpenAI key) | USER credential | waiting |
| P0.2 | Cypher parameter binding in graph_writer.py | — | independent |
| P0.3 | Mutation integration tests | dev Convex (up) | independent |
| P0.4 | Regression budgets in benchmarks | — | independent |
| P0.5 | Playwright smoke tests | working prod URL (P0.1) | partial independent |
| P0.6 | Run-all wrapper + GH Action on PR | P0.2–P0.4 | chains above |
| P0.7 | Production canary (GH Action cron) | P0.1 for pass | ship anyway |
| P0.8 | RUNBOOK.md | — | independent |

Strategy: ship P0.2, P0.3, P0.4, P0.6, P0.7, P0.8 now; stage P0.5 against whatever URL is live; flag P0.1 clearly for user.

---

## Invariants enforced after this work

1. **Retrieval R@5 medium ≥ 85%** — benchmark `exit 1` if below (P0.4)
2. **Hard R@5 ≥ 60%** — same (P0.4)
3. **Unanswerable = 100%** — same (P0.4)
4. **ACL = 100%** — suite `exit 1` if any fail (P0.4)
5. **Production search succeeds every 15min** — canary (P0.7)
6. **Mutations round-trip correctly** — smoke (P0.3)
7. **No Cypher injection via entity names** — parameterized queries (P0.2)

---

## Exit criteria

This sprint is "done" when:
- [ ] Every item above is committed + pushed
- [ ] A fresh Bedrock token (or permanent replacement) is in place
- [ ] The canary runs green for 1h
- [ ] `./scripts/run_all_tests.sh` exits 0 locally
- [ ] RUNBOOK.md is linked from README
