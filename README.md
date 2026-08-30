# Maestro

Maestro is a portable Agent Skill for dynamic multi-role software collaboration. A small npm CLI
installs the same Skill Core into the project-local directory expected by each supported AI coding
host.

The user works primarily with **Old Zhou**, who decides whether to handle a request directly,
delegate a stable role, or resolve a Worker from the current work's required capabilities.
Maestro preserves continuity through Temporary, Task, and Long-term project memory without forcing
every request through a fixed workflow.

## Install with the multi-host CLI

Requires Node.js 20.19 or newer. Install the CLI once:

```bash
npm install -g maestro-ai-workflow
```

Then initialize Maestro inside a project:

```bash
cd your-project
maestro init
```

Interactive initialization detects likely hosts and lets you select one or more. For scripts or
CI, pass the selection explicitly:

```text
maestro init --tools codex,claude,opencode
```

The MVP supports:

| Tool ID | Host | Generated Skill directory |
| --- | --- | --- |
| `codex` | Codex and shared Agent Skills hosts | `.agents/skills/maestro/` |
| `claude` | Claude Code | `.claude/skills/maestro/` |
| `opencode` | OpenCode | `.opencode/skills/maestro/` |

Run `maestro init --tools all` to install all three or `maestro init --tools none` to initialize
only Maestro's project metadata. Existing non-empty Skill directories are never adopted silently;
use `--force` only after reviewing the destination.

Refresh CLI-managed Skill files and inspect an installation with:

```text
maestro update
maestro doctor
maestro doctor --json
```

The CLI stores its local installation selection in `.maestro/installation.json` and places a
`.maestro-managed.json` ownership marker in each generated Skill. Updates overwrite canonical
Maestro files but preserve unrelated user-authored files.

## Manual installation

The complete portable Skill Core is the [`maestro/`](maestro/) directory. A host that implements
Agent Skills can use it directly by copying its contents into a host-recognized Skill directory so
that `SKILL.md` is at the Skill root. Hosts without Agent Skills require a separate thin adapter.

Alternatively, package the contents of `maestro/` as a ZIP and upload/install it as one Skill.

The CLI is only an installer, updater, and diagnostic tool. It never schedules roles, interprets
Memory, grants permissions, or runs a workflow state machine. Once installed, Maestro runs through
the selected AI host's native filesystem and agent capabilities; no background Runtime is needed.

## Use

Start naturally in a project:

```text
使用 Maestro 帮我分析这个项目的启动性能问题。
```

Or address Old Zhou:

```text
老周，我想先讨论一下新架构，暂时不要正式开工。
```

Direct role calls are supported:

```text
老陈帮我 review 这个设计。
阿强调查一下当前调用链，先不要改代码。
大春实现这个已经确认的修改。
```

Capability routing can reuse or compose registered Workers and can create a bounded Worker when no
safe reusable match exists. Generated Workers follow the existing Task, Temporary, or one-off
Session lifecycle, cannot grant themselves permissions, and never become permanent roles
automatically.

Workers do not rely on implicit inheritance from the parent Agent. Each Worker declares required
and optional instruction references, and each run materializes a minimal Delegation Packet with
resolved instruction digests, context references, effective tools and permissions, and the host's
support status. A missing required instruction or unenforceable boundary stops the delegation.
Semantic validation cross-checks each packet against an independently supplied Worker snapshot and
recomputes instruction digests from trusted Core or project roots.

Maestro creates project-owned state under `.maestro/` only when the request needs persistence. It
asks for confirmation before turning exploratory discussion into a formal Task.

At durable boundaries, the Memory Worker compares sourced Temporary or Task findings with current
Long-term entries and proposes reviewed `UPDATE`, `MERGE`, `CREATE`, or `SKIP` actions. It never
copies execution logs directly into Long-term Memory or approves its own proposal. Across concurrent
Git branches, `memory-merger` performs 3-way semantic consolidation and preserves full dual-sided
provenance on unresolved conflicts.

## Behavior evals

Maestro includes 21 structured Agent behavior cases covering work-shape decisions, role and Worker
routing, delegated-run waiting, Temporary/Task/Long-term Memory, Session Handoffs, and authorization
boundaries. Run the deterministic runner/fixture self-test with:

```text
npm run test:evals:fixtures
```

The replay checks the eval schema, observation contract, assertion engine, and expected baseline;
it is not a live Agent regression result. To run the current Skill through the included Codex CLI
reference adapter after changing `SKILL.md` or its references, use:

```text
npm run test:evals:live:codex
```

See [`maestro/evals/README.md`](maestro/evals/README.md) for the case format, normalized observation
contract, optional LLM judge interface, and CI/live-run distinction.

## npm package contents

```text
bin/
  maestro.js
cli/
  hosts.js
  index.js
  install.js
maestro/
  SKILL.md
  evals/
    cases/
    fixtures/
  references/
    coordination.md
    storage.md
    memory.md
    handoffs.md
    playbooks.md
    workers.md
    workers/
    roles/
    schemas/
```

All orchestration behavior is expressed through the Skill and its references. The Node.js files
perform only deterministic installation and validation work; the selected host's native filesystem
and sub-agent capabilities execute Maestro itself.
