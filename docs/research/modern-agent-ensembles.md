# Modern agent ensembles and Mixture-of-Agents

## Answer

Yes. There are now systems that apply ensemble and aggregation techniques to
modern, multi-turn, tool-using agents.

Two projects are especially relevant:

1. **TUMIX** is the closest modern-agent analogue of the original layered MoA.
   It repeatedly runs a fixed, diverse set of tool-using agents, gives every
   agent all answers from the preceding round, and selects a final result.
2. **AggAgent** runs several complete long-horizon agent trajectories in
   parallel, then gives a separate aggregation agent tools for inspecting and
   synthesizing those trajectories.

Broader multi-agent systems such as Anthropic Research, AutoGen
Society-of-Mind, and Magentic-One also use real tool-using agents and synthesis,
but their supervisor/team topologies differ from Together's fixed layered MoA.

## Taxonomy

- **Together MoA:** parallel model answers, repeated refinement, then final
  synthesis. Repeats layers but does not use modern tool-using agents.
- **TUMIX:** parallel tool-strategy agents, repeated refinement, then final
  selection. Uses modern agents and repeats layers.
- **AggAgent:** parallel full trajectories followed by agentic trajectory
  synthesis. Uses modern agents without repeated layers.
- **Supervisor-worker:** dynamic delegation and synthesis with modern agents;
  usually no repeated fixed team.
- **Society/team:** inner discussion or role collaboration followed by
  synthesis; tool use varies and fixed-layer repetition is uncommon.

## Closest match: TUMIX

Google's **Tool-Use Mixture (TUMIX)** explicitly extends MoA-style test-time
scaling with Code Interpreter and Search.

Its default configuration uses 15 agent strategies, including:

- chain-of-thought and code-oriented agents;
- Search agents;
- Code Interpreter agents;
- agents with both Search and Code Interpreter;
- guided agents that choose or steer tool usage.

Some agents run multi-turn tool loops, with up to five tool interactions. The
default repeats the same 15-agent set in every refinement round:

1. Every agent receives the original question.
2. Every agent receives all answers from the previous round.
3. Every agent independently runs its configured reasoning/tool strategy.
4. An LLM decides when enough refinement has occurred, subject to a minimum of
   two rounds.
5. Majority voting or an LLM selector chooses the final answer.

This is materially closer to a modern definition of "Mixture of Agents" than
the original paper: agents can search, execute code, observe results, and
continue their reasoning before returning an answer.

TUMIX reports that diversity of **agent strategy and tool access** matters more
than merely sampling the same strongest agent. It also reports a failure mode
important for implementation: later rounds improve average answers but reduce
diversity, sometimes converging on a shared wrong answer. Adaptive stopping
retained near-peak performance at roughly 49% of unrestricted refinement cost.

Sources:

- [Google Research publication][tumix-google]
- [TUMIX paper and algorithm][tumix-paper]

## Full-trajectory aggregation: AggAgent

**AggAgent** targets long-horizon agentic search and deep-research tasks. It
runs multiple complete ReAct trajectories independently. Each trajectory may
contain several reasoning steps, search/page-visit tool calls, observations,
and a final answer.

Instead of concatenating every trajectory into one oversized prompt, the final
aggregation agent treats trajectories as an environment. It has lightweight
tools to:

- retrieve complete candidate solutions;
- inspect selected trajectory segments;
- search across trajectory contents;
- cross-check evidence and resolve conflicts.

This is a strong example of a modern **agent ensemble**, although it is not a
layered MoA: candidate agents do not consume each other's outputs and rerun.
It is one parallel rollout stage followed by an agentic synthesis stage.

The published implementation uses eight parallel ReAct rollouts per benchmark
instance and evaluates across six benchmarks and three model families.

Sources:

- [AggAgent paper][aggagent-paper]
- [Official implementation][aggagent-repo]

## Other relevant systems

### Scaling test-time compute for LLM agents

A 2025 study systematically evaluates parallel sampling, sequential revision,
verification, and result-merging strategies for language agents. It finds that
parallel and diversified rollouts can improve agent performance and that
list-wise merging performs best among tested merging methods. This establishes
agent-trajectory ensembles as a broader research direction rather than one
isolated implementation.

Source: [Scaling Test-time Compute for LLM Agents][agent-tts]

### Anthropic multi-agent Research

Anthropic's Research system uses a lead agent with memory that creates parallel,
tool-using research subagents, synthesizes their findings, optionally launches
more workers, and hands the result to a Citation Agent. This is a modern agent
ensemble, but its topology is adaptive supervisor-worker rather than a fixed
team repeated layer-by-layer.

Anthropic's taxonomy calls fixed parallel attempts and aggregation a workflow;
it reserves "agent" for systems where the LLM dynamically controls its own
process and tool usage. Its guidance also emphasizes increased latency, token
cost, and the need for sandboxing and measurement.

Sources:

- [Anthropic multi-agent Research system][anthropic-research]
- [Anthropic agent taxonomy][anthropic-agents]

### AutoGen

AutoGen's `SocietyOfMindAgent` runs an inner agent team and uses another model
call to produce a standalone response from the team's transcript. Team members
can be normal AutoGen agents with tools.

Magentic-One uses a planning orchestrator plus WebSurfer, FileSurfer, Coder, and
ComputerTerminal agents. It is genuinely agentic and stateful, but delegates
subtasks adaptively rather than running a full fixed team in repeated parallel
layers.

AutoGen also documents a literal MoA design pattern, but that example's workers
are single model calls rather than autonomous tool loops.

Sources:

- [SocietyOfMind implementation][autogen-society]
- [Magentic-One documentation][magentic-one]
- [AutoGen MoA pattern][autogen-moa]

## Implications for the Pi extension

There are now two defensible designs with different goals:

### Paper-faithful MoA

Use the current virtual-provider plan:

- tool-free reference model calls;
- same reference roster across layers;
- all preceding-layer answers supplied to every next-layer model;
- one acting aggregator.

This reproduces the architecture actually tested by Together.

### Modern agent ensemble

Use complete Pi subagents:

- launch several read-only or worktree-isolated agents in parallel;
- let each use normal tools and run a bounded agent loop;
- preserve full trajectories as artifacts;
- give the final aggregator bounded reports or trajectory-inspection tools;
- optionally repeat the team with preceding reports, following TUMIX.

For coding tasks, start with the AggAgent-shaped version: one parallel agent
round followed by synthesis. Repeated TUMIX-style rounds multiply cost and tend
to collapse diversity. Add later rounds only if repository-specific evaluation
shows a gain.

Do not allow parallel reference agents to mutate one shared checkout. Use
read-only tools for advisory agents or isolated worktrees for implementation
agents.

## Conclusion

"Modern MoA" is no longer merely a hypothetical idea:

- **TUMIX** demonstrates the original repeated-layer topology with multi-turn
  Search and Code Interpreter agents.
- **AggAgent** demonstrates aggregation of complete, tool-augmented,
  long-horizon trajectories.
- Production-oriented systems already use related supervisor/team patterns.

For Pi, a full-agent version should be called an **agent ensemble** unless it
actually repeats the full agent set with preceding-round fan-in. TUMIX provides
the clearest precedent for calling that repeated version a modern
Mixture-of-Agents.

[tumix-google]: https://research.google/pubs/tumix-augmenting-llm-reasoning-with-a-dynamic-tool-use-mixture/
[tumix-paper]: https://arxiv.org/html/2510.01279
[aggagent-paper]: https://arxiv.org/abs/2604.11753
[aggagent-repo]: https://github.com/princeton-pli/AggAgent
[agent-tts]: https://arxiv.org/abs/2506.12928
[anthropic-research]: https://www.anthropic.com/engineering/multi-agent-research-system
[anthropic-agents]: https://www.anthropic.com/research/building-effective-agents
[autogen-society]: https://microsoft.github.io/autogen/stable/_modules/autogen_agentchat/agents/_society_of_mind_agent.html
[magentic-one]: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/magentic-one.html
[autogen-moa]: https://microsoft.github.io/autogen/dev/user-guide/core-user-guide/design-patterns/mixture-of-agents.html
