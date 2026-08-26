# Maestro v1

Maestro v1 is a host-neutral, multi-role collaboration system built from scratch.

It intentionally does not implement a fixed delivery state machine. Old Zhou decides what should
happen next; roles perform specialist work; the Runtime only provides deterministic storage,
memory boundaries and safe contracts.

## First runnable slice

This initial implementation includes:

- a portable `skills/maestro/SKILL.md` controller contract;
- Temporary, Task and Long-term memory directories;
- explicit confirmation before a formal Task is created;
- Detailed Result, per-role Current State and lightweight Handoff receipts;
- `current + references` memory storage;
- a host-neutral Memory Worker contract with one retry, primary-model fallback and
  `memory_pending` preservation;
- a zero-runtime-dependency Node.js CLI and test suite.

## Quick start

```bash
npm test
node bin/maestro.js init --root /path/to/project
node bin/maestro.js temp-create --root /path/to/project --title "Investigate startup performance"
```

Create a formal Task only after user confirmation:

```bash
node bin/maestro.js task-create \
  --root /path/to/project \
  --temp <temporary-id> \
  --objective "Improve startup performance" \
  --confirmed
```

Record one role run:

```bash
node bin/maestro.js role-record \
  --root /path/to/project \
  --task <task-id> \
  --role laborer \
  --file role-result.json
```

The CLI does not choose or call a vendor model. A host can inject a Memory Worker runner through
the JavaScript API, or pass a previously generated response with `--memory-response`.

## Project data

Runtime data is created below `.maestro/` in the target project. It is project-owned and can be
restored without relying on an earlier Agent session.
