# Related Works for Guarded Agentic Release

This memo collects citable related work for the Guarded Agentic Release paper draft. Every item below has a local PDF copy in `docs/research/ref/` and a primary or open source URL for traceability.

## How to Use These References

- Use `docs/research/references.bib` as the working bibliography file for Pandoc/LaTeX drafts.
- Every BibTeX entry includes a `url` field for the source and a `file` field pointing to the local PDF copy under `docs/research/ref/`.
- Use the "Agent foundations" papers to frame release planning as a tool-using, reasoning-and-acting agent problem.
- Use the "Software and operations agents" papers to position this work near SWE-bench, SWE-agent, CodeAct, AIOpsLab, and IT-operations benchmarks.
- Use the "Safety and guardrails" papers to argue that agent autonomy needs external monitors, risk evaluation, and policy enforcement.
- Use the "Runtime enforcement" papers to ground the deterministic verifier in older safety/security literature, not just LLM prompting.

## Agent Foundations and Tool Use

| Citation key | Paper | Why it matters here | Local PDF | Source |
| --- | --- | --- | --- | --- |
| `yao2023react` | Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models" | Establishes the reasoning-plus-action loop that many LLM agents build on. Useful for introducing release planning as interleaved reasoning over state and action labels. | `docs/research/ref/react-yao-2023.pdf` | https://arxiv.org/abs/2210.03629 |
| `schick2023toolformer` | Schick et al., "Toolformer: Language Models Can Teach Themselves to Use Tools" | Early tool-use paper; useful background for why LLMs can call external APIs but still need constraints around tool execution. | `docs/research/ref/toolformer-schick-2023.pdf` | https://arxiv.org/abs/2302.04761 |
| `wang2023surveyagents` | Wang et al., "A Survey on Large Language Model based Autonomous Agents" | Broad survey of LLM agent architectures, applications, and evaluations. Good for related-work framing. | `docs/research/ref/llm-autonomous-agents-survey-wang-2023.pdf` | https://arxiv.org/abs/2308.11432 |
| `liu2023agentbench` | Liu et al., "AgentBench: Evaluating LLMs as Agents" | A general benchmark for LLM agents in interactive environments. Useful contrast: our benchmark is narrower but operationally safety-focused. | `docs/research/ref/agentbench-liu-2023.pdf` | https://arxiv.org/abs/2308.03688 |

## Software Engineering and Operations Agents

| Citation key | Paper | Why it matters here | Local PDF | Source |
| --- | --- | --- | --- | --- |
| `jimenez2023swebench` | Jimenez et al., "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?" | Canonical real-world software engineering benchmark. Our benchmark is similar in spirit but targets release operations rather than issue resolution. | `docs/research/ref/swe-bench-jimenez-2023.pdf` | https://arxiv.org/abs/2310.06770 |
| `yang2024sweagent` | Yang et al., "SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering" | Shows that agent-computer interfaces materially affect software-agent performance. Useful for arguing for closed release-action interfaces. | `docs/research/ref/swe-agent-yang-2024.pdf` | https://arxiv.org/abs/2405.15793 |
| `wang2024codeact` | Wang et al., "Executable Code Actions Elicit Better LLM Agents" | Relevant to action-space design and executable tools. Our work differs by scoring release command labels offline and blocking execution with a verifier. | `docs/research/ref/codeact-wang-2024.pdf` | https://arxiv.org/abs/2402.01030 |
| `shetty2024aiopslab` | Shetty et al., "Building AI Agents for Autonomous Clouds: Challenges and Design Principles" | Closest operational benchmark framing: cloud operations, fault injection, and agent-cloud interfaces. Useful for positioning release agents as a constrained AIOps case. | `docs/research/ref/aiopslab-shetty-2024.pdf` | https://arxiv.org/abs/2407.12165 |
| `liu2023opseval` | Liu et al., "OpsEval: A Comprehensive IT Operations Benchmark Suite for Large Language Models" | Shows emerging LLM evaluation for IT operations tasks. Use as related benchmark work, while emphasizing our focus on release safety policies. | `docs/research/ref/opseval-liu-2023.pdf` | https://arxiv.org/abs/2310.07637 |
| `bilal2026netopsaiops` | Bilal et al., "Large Language Models for Agentic NetOps and AIOps: Architectures, Evaluation, and Safety" | Very close framing: operational agents need evidence traces, permission boundaries, checks, rollback, and constrained autonomy. | `docs/research/ref/llm-netops-aiops-survey-2026.pdf` | https://arxiv.org/abs/2605.12729 |

## Agent Safety, Guardrails, and Risk Evaluation

| Citation key | Paper | Why it matters here | Local PDF | Source |
| --- | --- | --- | --- | --- |
| `ruan2023toolemu` | Ruan et al., "Identifying the Risks of LM Agents with an LM-Emulated Sandbox" | Directly supports offline risk testing of tool-using agents. Our benchmark similarly avoids live high-impact execution. | `docs/research/ref/toolemu-ruan-2023.pdf` | https://arxiv.org/abs/2309.15817 |
| `debenedetti2024agentdojo` | Debenedetti et al., "AgentDojo: A Dynamic Environment to Evaluate Prompt Injection Attacks and Defenses for LLM Agents" | Shows that tool-using agents need explicit security evaluation, especially when external tool outputs can alter behavior. | `docs/research/ref/agentdojo-debenedetti-2024.pdf` | https://arxiv.org/abs/2406.13352 |
| `naihin2023safewild` | Naihin et al., "Testing Language Model Agents Safely in the Wild" | Strongly related to our design: agent actions are audited by a context-sensitive monitor and unsafe behavior is stopped and logged. | `docs/research/ref/testing-lm-agents-safely-wild-2023.pdf` | https://arxiv.org/abs/2311.10538 |
| `dong2024safeguarding` | Dong et al., "Safeguarding Large Language Models: A Survey" | Broad survey of guardrails/safeguards. Useful for positioning deterministic verifier policies against prompt-only safety. | `docs/research/ref/safeguarding-llms-survey-2024.pdf` | https://arxiv.org/abs/2406.02622 |
| `bai2022constitutional` | Bai et al., "Constitutional AI: Harmlessness from AI Feedback" | Useful contrast: rule/principle-based model behavior shaping is related but different from deterministic runtime policy enforcement. | `docs/research/ref/constitutional-ai-bai-2022.pdf` | https://arxiv.org/abs/2212.08073 |
| `huang2023llmsafetyvv` | Huang et al., "A Survey of Safety and Trustworthiness of Large Language Models through the Lens of Verification and Validation" | Connects LLM safety to verification, validation, falsification, and runtime monitoring. Helps justify safety metrics beyond task accuracy. | `docs/research/ref/llm-safety-vv-survey-huang-2023.pdf` | https://arxiv.org/abs/2305.11391 |

## Runtime Enforcement and Policy Verification

| Citation key | Paper | Why it matters here | Local PDF | Source |
| --- | --- | --- | --- | --- |
| `schneider2000enforceable` | Schneider, "Enforceable Security Policies" | Classic runtime monitoring/security automata paper. Useful theoretical foundation for policies that can be enforced by monitoring executions. | `docs/research/ref/enforceable-security-policies-schneider-2000.pdf` | https://www.cs.cornell.edu/fbs/publications/EnfSecPols.pdf |
| `ligatti2003editautomata` | Ligatti, Bauer, and Walker, "Edit Automata: Enforcement Mechanisms for Run-time Security Policies" | Broadens runtime enforcement from stopping actions to suppressing/inserting actions. Useful analogy for a verifier that rewrites raw plans into verified plans. | `docs/research/ref/edit-automata-ligatti-bauer-walker-2003.pdf` | https://cse.usf.edu/~ligatti/papers/TR-681-03.pdf |
| `alshiekh2017shielding` | Alshiekh et al., "Safe Reinforcement Learning via Shielding" | Useful safety analogy: a shield constrains an agent's action set before unsafe behavior occurs. Our verifier is a deployment-policy shield. | `docs/research/ref/safe-rl-via-shielding-alshiekh-2017.pdf` | https://arxiv.org/abs/1708.08611 |

## Suggested Related-Work Paragraph Structure

1. "LLM agents and tool use": cite ReAct, Toolformer, and the LLM-agent survey.
2. "Software and operations benchmarks": cite SWE-bench, SWE-agent, CodeAct, AIOpsLab, OpsEval, and the NetOps/AIOps survey.
3. "Safety evaluation for tool-using agents": cite ToolEmu, AgentDojo, and Testing Language Model Agents Safely in the Wild.
4. "Guardrails and verification": cite Safeguarding LLMs, the LLM safety V&V survey, Schneider, edit automata, and shielding.

The main positioning sentence can be:

> Unlike broad agent benchmarks or software-repair benchmarks, Guarded Agentic Release evaluates whether an agent can recommend operational release actions while a deterministic verifier preserves deployment policy, human confirmation, and auditability.
