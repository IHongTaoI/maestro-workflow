# Maestro

Maestro is an installable Codex Skill for dynamic multi-role software collaboration.

The user works primarily with **Old Zhou**, who decides whether to handle a request directly,
delegate a stable role, or resolve a Worker from the current task's required capabilities.
Maestro preserves continuity through Temporary, Task, and Long-term project memory without forcing
every request through a fixed workflow.

## Install

The complete Skill is the [`maestro/`](maestro/) directory.

Copy it into the Codex skills directory:

```text
~/.codex/skills/maestro/
```

The installed directory must contain:

```text
~/.codex/skills/maestro/SKILL.md
~/.codex/skills/maestro/references/
```

Alternatively, package the contents of `maestro/` as a ZIP and upload/install it as one Skill.
There is no npm installation, background service, CLI, or JavaScript Runtime.

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

Capability routing can reuse or compose registered Workers and can create a bounded Task-scoped
Worker when no safe reusable match exists. Generated Workers expire with the Task, cannot grant
themselves permissions, and never become permanent roles automatically.

Maestro creates project-owned state under `.maestro/` only when the request needs persistence. It
asks for confirmation before turning exploratory discussion into a formal Task.

## Package contents

```text
maestro/
  SKILL.md
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

All orchestration behavior is expressed through the Skill and its references. The host's native
filesystem and sub-agent capabilities provide the mechanical operations described by the original
Maestro v1 initialization plan.
