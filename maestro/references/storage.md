# Project Storage

Maestro state belongs to the target project, never the installed Skill.

## Minimal layout

Create directories lazily as the current work needs them:

```text
.maestro/
  config.yaml
  memory/
    temporary/
      active/<temporary-id>/
        meta.yaml
        current.md
        references/
      archive/
      trash/
    pending/
    long-term/
      current.md
      candidates/
        pending/
        approved/
        rejected/
      decisions/
  tasks/
    <task-id>/
      task.yaml
      context.md
      decisions.md
      progress.md
      evidence/
      artifacts/
      handoffs/
      roles/<role>/
        current-state.md
        references/
        runs/
    archive/
  playbooks/
```

The `playbooks/` directory may be supplied by the project before Maestro is first used.

## Configuration

Use a small `config.yaml`:

```yaml
schema_version: 1
models:
  primary: null
  memory: null
```

Do not invent fine-grained per-role model settings in v1. A null memory model means use the host's
available model or perform the compression in the current agent.

## File rules

- Resolve every write beneath the selected project's `.maestro/` directory.
- Reject traversal such as `../` and do not follow a supplied absolute path as a state destination.
- Use stable, filesystem-safe IDs containing a UTC timestamp and a short random suffix.
- Prefer Markdown for human-maintained state and YAML for small metadata/configuration.
- Write complete replacement content through the host's safest available atomic edit mechanism.
- Preserve existing unrelated content and user-authored Playbooks.
- Never delete an active Task, Temporary Memory, Evidence, or Artifact merely because it was
  compressed. Move it to Archive or Trash according to the user's intent.

## State transitions

Storage transitions do not define business workflow. Allowed lifecycle moves are:

- Temporary `active` → `archive` or `trash`.
- Temporary `active` → formal Task after explicit confirmation, then Temporary → `archive`.
- Task active → `archive` after completion.
- Long-term candidate `pending` → `approved` or `rejected` after review.

Record the transition, timestamp, actor/reviewer, rationale when relevant, and source paths before
moving the directory or file.
