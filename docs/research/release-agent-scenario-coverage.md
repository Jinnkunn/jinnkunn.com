# Release Agent Scenario Coverage

This report summarizes the research-only offline scenario corpus used by the Guarded Agentic Release benchmark.

Regenerate the detailed tag report with:

```bash
npm run benchmark:release-agent:coverage
```

Run a low-cost rule-only canary on the first 10 expanded scenarios with:

```bash
npm run benchmark:release-agent:experiments -- \
  --conditions=rule-only \
  --scenario-tag=expanded-v4 \
  --limit=10 \
  --runs=1 \
  --output-dir=output/research/release-agent-benchmark-runs/rule-expanded-tags-10 \
  --json --compact
```

## Corpus Summary

- Total scenarios: 60
- Original Batch A prefix: 30
- Expanded v4 scenarios: 30
- Rule-only baseline on current corpus: all core accuracy metrics `1.000`; safety violation metrics `0.000`

## Coverage Summary

| Group | Tag | Count |
| --- | --- | ---: |
| Corpus Split | `batch-a` | 30 |
| Corpus Split | `expanded-v4` | 30 |
| Target | `target-production` | 53 |
| Target | `target-staging` | 7 |
| Decision Shape | `noop` | 8 |
| Decision Shape | `staging-action` | 14 |
| Decision Shape | `production-action` | 9 |
| Decision Shape | `blocked` | 33 |
| Decision Shape | `allowed-execution` | 10 |
| Decision Shape | `human-confirmation` | 9 |
| Release Surface | `code-deploy` | 3 |
| Release Surface | `code-promotion` | 4 |
| Release Surface | `content-change` | 12 |
| Release Surface | `content-overlay` | 20 |
| Release Surface | `content-publish` | 11 |
| Release Surface | `now-content` | 3 |
| Release Surface | `rollback` | 5 |
| Hard Blockers | `hard-blocker` | 33 |
| Hard Blockers | `combined-blockers` | 6 |
| Hard Blockers | `runner` | 9 |
| Hard Blockers | `active-job` | 8 |
| Hard Blockers | `auth-failure` | 4 |
| Hard Blockers | `release-job` | 2 |
| Hard Blockers | `static-shell` | 5 |
| Hard Blockers | `route-parity` | 8 |
| Hard Blockers | `branch-policy` | 4 |
| Hard Blockers | `dirty-worktree` | 6 |
| Hard Blockers | `rollback-unavailable` | 2 |
| State Drift | `metadata-missing` | 3 |
| State Drift | `staging-code-drift` | 8 |
| State Drift | `production-code-drift` | 12 |
| State Drift | `route-parity-mismatch` | 7 |
| State Drift | `route-parity-skipped` | 1 |
| State Drift | `production-history-dirty` | 3 |

## Coverage Notes

- The corpus is intentionally production-heavy because the research question focuses on safe release automation and production confirmation policy.
- The v4 expansion adds composition cases rather than more happy paths: staging or production plans interrupted by runner, job, auth, static-shell, route-parity, branch, dirty-worktree, and rollback blockers.
- The current corpus contains 33 blocked cases and 6 combined-blocker cases, which makes it useful for evaluating blocker recall and verifier intervention.
- Only 10 scenarios are immediately executable under the offline policy model. This is expected: production-affecting actions can be correct recommendations while still requiring human confirmation.
- Future expansion should add more staging-only safe work, evidence-grounding challenges, and additional rollback/static-shell variants before spending more API budget on larger DeepSeek runs.
