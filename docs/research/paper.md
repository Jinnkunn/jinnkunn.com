---
title: "Guarded Agentic Release: Offline Evaluation of Policy-Verified Deployment Agents"
author:
  - "Jinkun Chen"
date: "2026-05-18"
bibliography: references.bib
link-citations: true
numbersections: true
geometry: margin=1in
abstract: |
  Language-model agents can often choose plausible operational commands while still violating deployment policy. This paper studies that gap in the setting of release planning. Guarded Agentic Release is an offline benchmark and verifier design for evaluating whether a deployment agent can recommend release actions while preserving hard blockers, production confirmation, and execution gating. The benchmark contains 60 scenarios derived from a real staging/production release workflow. We compare a deterministic rule baseline, three DeepSeek planner prompts, and an unverified DeepSeek-only condition. In the final Batch B2 evaluation, the guarded condition reaches 0.983 action accuracy and 0.983 script accuracy with zero unsafe allowed execution, while the unverified condition still has blocker recall 0.000 and hard-blocker miss rate 1.000 despite high command-selection accuracy. The results support a simple design principle: operational agents should separate planning from authority, using deterministic verification to decide whether a proposed command is blocked, confirmation-gated, or executable.
---

# Introduction

Language-model agents are increasingly framed as systems that can reason, choose actions, and interact with tools. This framing is useful for software operations: a release assistant can inspect deployment state, explain what changed, and recommend a next action. It is also dangerous. In a deployment workflow, choosing a plausible command is not enough. A command may be correct as a recommendation while still being unsafe to execute because the working tree is dirty, the branch is wrong, a runner is offline, a production confirmation is missing, or a rollback precondition is not satisfied.

This paper studies that distinction through Guarded Agentic Release, an offline benchmark and verifier for release-planning agents. The system separates interpretation from authority. A planner, either a rule baseline or an LLM, emits a raw plan containing an action, script, reason, and evidence. A deterministic verifier then normalizes the plan, enforces deployment policy, inserts blockers, and decides whether execution would be allowed. The benchmark scores this verified output against author-defined offline labels, but never runs release scripts or calls live infrastructure.

The central claim is that release agents should be evaluated on policy correctness, not only command plausibility. Our results show why. In the final 60-scenario Batch B2 evaluation, the unverified DeepSeek-only condition has high action and script accuracy, but blocker recall is 0.000 and hard-blocker miss rate is 1.000. By contrast, the guarded condition is not planning-perfect, but its unsafe allowed-execution rate is 0.000. The verifier does not make the planner always correct; it changes unsafe mistakes into blocked, auditable failures.

This work makes three contributions:

1. A 60-scenario offline benchmark for release-agent decisions, derived from a real staging/production workflow but isolated from live deployment.
2. A planner/verifier split that treats production confirmation, hard blockers, and action/script consistency as deterministic policy rather than prompt-only behavior.
3. An evaluation showing that high action/script accuracy can coexist with unsafe execution, and that deterministic verification can materially reduce unsafe release plans.

# System Design

Guarded Agentic Release uses a two-stage design. The planner reads a structured release scenario and emits a raw plan:

```text
action: string
script: string
reason: string
evidence: string[]
```

The verifier consumes the same scenario plus the raw plan and returns a verified output:

```text
action: string
script: string
reason: string
blockers: string[]
requiresHumanConfirmation: boolean
allowedToExecute: boolean
evidence: string[]
```

The verifier has four responsibilities. First, it constrains the command vocabulary so planners cannot invent arbitrary release scripts. Second, it enforces hard blockers such as runner unavailability, active jobs, dirty worktrees, non-main production state, authentication failures, static-shell misses, route parity mismatch, and rollback preconditions. Third, it enforces production human confirmation, so production-affecting actions can be recommended but not marked executable without an explicit confirmation gate. Fourth, after Batch B exposed a gap, it enforces action/script consistency: for example, `promote-production-code` cannot be paired with the staging script `release:staging`.

The current benchmark replaces live execution with label scoring. It records whether a command would be allowed, but it does not execute any command, deploy to staging or production, call Cloudflare, touch D1, or read live website state. This isolation is a methodological choice: operational behavior can be evaluated repeatedly before any live executor exists.

# Benchmark

The benchmark contains 60 release scenarios. The first 30 scenarios form the initial Batch A corpus. The expanded corpus preserves those scenarios and adds 30 composition cases. Each scenario contains structured release state, a target environment, and a gold label with expected action, expected script, required blockers, forbidden scripts, confirmation expectation, and execution allowance.

The scenarios cover current/no-op states, staging metadata gaps, staging code drift, content-only changes, content overlays, production code promotion, production overlay promotion, Now-only production copy, route parity mismatch, missing static-shell coverage, runner availability, active release jobs, authentication failure, dirty worktrees, non-main branches, rollback availability, and combined blockers.

The labels are offline policy labels, not records of live deployments. This distinction matters most for production actions. A production promotion can be the correct next recommendation while still having `allowedToExecute=false`, because production-affecting commands require human confirmation. The benchmark therefore distinguishes planning correctness from execution authority.

# Experimental Setup

We evaluate five conditions:

| Condition | Description |
| --- | --- |
| `rule-only` | Deterministic rule planner plus deterministic verifier. |
| `deepseek-naive` | Minimal DeepSeek prompt plus deterministic verifier. |
| `deepseek-structured` | Schema- and taxonomy-constrained DeepSeek prompt plus deterministic verifier. |
| `deepseek-guarded` | Policy-aware DeepSeek prompt plus deterministic verifier. |
| `deepseek-only` | Structured DeepSeek planner without the deterministic verifier. |

Each condition is run three times over the 60-scenario Batch B2 corpus. The DeepSeek conditions use `deepseek-v4-flash` with JSON-mode prompting. The run artifacts include per-scenario JSON reports, aggregate summaries, CSV/Markdown tables, and failure-analysis reports under `output/research/release-agent-benchmark-runs/batch-b2-runs-3-corpus-60-patched-verifier`.

The primary task metrics are `next_action_accuracy` and `script_accuracy`. The safety metrics are `blocker_recall`, `unsafe_allowed_execution_rate`, `production_confirmation_violation_rate`, `hard_blocker_miss_rate`, `invalid_script_rate`, and `verifier_intervention_rate`. The key methodological choice is to separate command selection from execution permission: an agent can select the right-looking command while missing the policy conditions that make it unsafe.

# Results

Table 1 reports the final Batch B2 evaluation. Means are computed over three runs. `Unsafe Max` and `Failure Max` report the worst run.

Table 1: Batch B2, full 60-scenario corpus with patched verifier.

| Condition | Verified | Action | Script | Blocker Recall | Unsafe Max | Hard Miss | Failure Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `rule-only` | yes | 1.000 | 1.000 | 1.000 | 0.000 | 0.000 | 0 |
| `deepseek-naive` | yes | 0.683 | 0.683 | 0.813 | 0.133 | 0.188 | 19 |
| `deepseek-structured` | yes | 0.900 | 0.933 | 0.979 | 0.000 | 0.021 | 6 |
| `deepseek-guarded` | yes | 0.983 | 0.983 | 0.979 | 0.000 | 0.021 | 1 |
| `deepseek-only` | no | 0.894 | 0.928 | 0.000 | 0.167 | 1.000 | 47 |

## RQ1: Planning Correctness

The deterministic rule baseline scores perfectly on the final 60-scenario corpus, indicating that the gold labels are internally consistent with the current rule implementation. Prompt structure has a large effect on planning. The naive DeepSeek condition reaches only 0.683 action accuracy and 0.683 script accuracy, often emitting plausible but invalid command names. The structured prompt improves action accuracy to 0.900 and script accuracy to 0.933 while eliminating invalid scripts. The guarded prompt improves further to 0.983 action and script accuracy.

These results support a closed-interface design. Before an agent can safely interact with deployment tooling, it should choose from a fixed action and script vocabulary. Free-form operational language is too easy to confuse with executable intent.

## RQ2: Safety Compliance

Planning correctness does not imply safety compliance. The unverified `deepseek-only` condition is strong on command selection, with 0.894 action accuracy and 0.928 script accuracy, but its safety scores collapse: blocker recall is 0.000, hard-blocker miss rate is 1.000, unsafe allowed execution reaches 0.167 in the worst run, and production confirmation violation reaches 0.183 in the worst run.

This is the central empirical signal. A release agent can recommend the right command-shaped action while still being unsafe to execute. For deployment agents, command accuracy is not a substitute for blocker recall, confirmation policy, and execution gating.

## RQ3: Verifier Effectiveness

The verifier changes model output from a suggested command into a policy-checked plan. In Batch B2, `deepseek-guarded` has one failure per run, but its unsafe allowed-execution rate is 0.000. The remaining failure is informative: on `content-overlay-covered-production-code-behind`, the planner repeatedly emits the production action `promote-production-code` with the staging script `release:staging`. The patched verifier blocks this as `action_script_mismatch`.

This illustrates the value of deterministic verification. The verifier does not make the planner correct; it prevents an inconsistent plan from becoming executable. The failure remains visible in the audit trail, but the execution gate stays closed.

## RQ4: Observability and Recoverability

The benchmark is replayable by design. Each run writes a complete JSON report with scenario inputs, raw planner outputs, verified outputs, metrics, and failure labels. Aggregate artifacts include `summary.json`, `summary.csv`, `summary.md`, and `failure-analysis.md`. A failure can be traced from an aggregate metric to a condition, run, scenario, expected label, raw model output, verified output, missing blockers, and safety classification.

This audit trail supports recoverability analysis without live infrastructure. For example, failures can be grouped by invalid command vocabulary, missing production confirmation, hard-blocker misses, environment confusion, action/script mismatch, rollback behavior, or conservative over-blocking. These categories guide whether to adjust prompts, expand verifier policy, or add new corpus scenarios.

# Failure Analysis

Batch B2 produces 217 failures across 15 reports. The top categories are ignored blockers, wrong scripts, missing human confirmation, unsafe allowed execution, staging/production confusion, and unsafe production commands.

| Category | Count |
| --- | ---: |
| Ignored blocker | 159 |
| Wrong script | 85 |
| Missing human confirmation | 64 |
| Unsafe allowed execution | 52 |
| Staging/production confusion | 46 |
| Unsafe production command | 28 |
| Over-blocking | 21 |
| Label mismatch | 12 |
| Wrong rollback behavior | 6 |
| Action/script mismatch | 3 |

Unsafe failures dominate the unverified condition. Although `deepseek-only` often selects plausible actions and scripts, it misses required blockers and confirmation policy. Missing `production_requires_confirmation`, `runner_offline`, `active_job_running`, or static-shell blockers changes the semantics of a plan: a correct command without its guard condition is an unsafe execution recommendation.

Interface failures are most visible in the naive condition. The model invents shell-like deployment commands or imprecise publish commands instead of selecting from the closed release vocabulary. Structured prompting eliminates invalid scripts, but it does not remove all missed blockers or confirmation failures.

Action/script mismatch is the key verifier iteration. In the pre-patch Batch B diagnostic run, `promote-production-code` paired with `release:staging` could be treated as executable. Batch B2 blocks the same inconsistency with `action_script_mismatch`. The result counts as a planning failure, but not as unsafe execution. This is the intended behavior for a guarded operational assistant.

# Related Work

Guarded Agentic Release builds on work on LLM agents and tool use. ReAct introduced a reasoning-and-acting pattern in which models interleave natural-language reasoning with environment actions [@yao2023react]. Toolformer showed that models can learn to use external tools [@schick2023toolformer]. Surveys of LLM-based autonomous agents organize this space around planning, memory, tool use, and reflection [@wang2023surveyagents]. AgentBench evaluates LLMs as agents across interactive environments, motivating agent-specific benchmarks rather than static question answering alone [@liu2023agentbench].

Software-agent benchmarks evaluate models on realistic engineering tasks. SWE-bench measures whether models can resolve real GitHub issues [@jimenez2023swebench], while SWE-agent shows that the agent-computer interface strongly affects software-engineering performance [@yang2024sweagent]. CodeAct explores executable code actions as an agent action space [@wang2024codeact]. Guarded Agentic Release shares the focus on realistic developer workflows, but its success criteria target release-policy safety rather than issue resolution.

Operations-focused work is closer to this setting. OpsEval evaluates LLMs on IT operations tasks [@liu2023opseval]. AIOpsLab proposes an environment for autonomous cloud agents with fault injection and operational workflows [@shetty2024aiopslab]. Recent NetOps/AIOps surveys emphasize evidence traces, permission boundaries, constrained autonomy, checks, and rollback mechanisms [@bilal2026netopsaiops]. This paper takes a narrower but more policy-specific slice: release decisions for a staging/production workflow with content overlays, static-shell checks, runner state, and production confirmation.

Several works study safety risks for tool-using agents. ToolEmu evaluates LM agents in an emulated sandbox to identify risky tool-use behavior without live side effects [@ruan2023toolemu]. AgentDojo evaluates prompt-injection attacks and defenses for tool-using agents [@debenedetti2024agentdojo]. Testing Language Model Agents Safely in the Wild studies live agent testing with monitors that can stop and log unsafe behavior [@naihin2023safewild]. These works support the decision to evaluate release behavior offline before considering live execution.

General guardrail and safety work further motivates policy layers. Safeguarding surveys organize mitigation strategies for LLM risks [@dong2024safeguarding]. Constitutional AI uses explicit principles to shape model behavior [@bai2022constitutional], while verification-and-validation surveys argue that LLM safety requires techniques beyond task accuracy [@huang2023llmsafetyvv]. Guarded Agentic Release follows this direction but makes the safety boundary deterministic: prompts can improve planner quality, but blockers, confirmation, and execution allowance are enforced outside the model.

The verifier is also related to runtime enforcement. Schneider's security automata formalize policies enforceable by monitoring executions [@schneider2000enforceable]. Edit automata broaden enforcement from stopping actions to suppressing or inserting actions [@ligatti2003editautomata]. In reinforcement learning, shielding constrains an agent's actions before unsafe behavior occurs [@alshiekh2017shielding]. Our verifier is an offline policy shield over proposed release plans: it normalizes actions, blocks unsafe states, inserts confirmation policy, and records auditable evidence.

# Discussion

The results support a guarded-autonomy design for deployment agents. The planner is useful for interpreting structured release state and producing a rationale, but it should not be the final authority on execution. A deterministic verifier can encode policies that are too brittle or too important to leave to language-model interpretation: production confirmation, dirty worktree blocking, branch requirements, runner availability, static-shell coverage, rollback preconditions, and action/script consistency.

The design also keeps research deploy-safe. Because the benchmark uses fixture states and command labels, it can evaluate release-agent behavior without touching live infrastructure. This makes it suitable for iterative prompt and verifier development before any live executor is introduced.

The Batch B to Batch B2 iteration is a useful example. The pre-patch verifier missed a subtle inconsistency between production action semantics and staging script syntax. The patched verifier added `action_script_mismatch` as a hard blocker. The planner still makes the mistake, but the verified system no longer allows it to execute. This is exactly the distinction the benchmark is meant to reveal.

# Limitations

This is an early offline study. The corpus contains 60 scenarios and comes from one personal infrastructure workflow. The labels reflect the current release policy and may not generalize to other deployment stacks. Batch B2 uses three runs per condition, which exposes large differences but does not estimate stability across model versions, decoding settings, or prompt variants. The benchmark also does not deeply evaluate evidence groundedness: it checks output fields and safety policies, but not whether every rationale sentence is fully supported by scenario facts.

The study does not include a user study. This is intentional for the current phase. The core question is whether automatic safety constraints reduce unsafe release plans in a reproducible offline benchmark. A later user study could evaluate operator trust, workload, and confirmation UX, but the first publishable result can stand on offline correctness and safety metrics.

# Conclusion

Deployment agents should not be evaluated only on command plausibility. In Guarded Agentic Release, an unverified LLM planner can appear competent on action and script selection while missing every required blocker. A deterministic verifier changes the safety profile: it cannot guarantee perfect planning, but it can prevent unsafe execution recommendations and preserve an audit trail. The broader lesson is simple: for operational agents, autonomy should be bounded by explicit policy verification before any live action is allowed.
