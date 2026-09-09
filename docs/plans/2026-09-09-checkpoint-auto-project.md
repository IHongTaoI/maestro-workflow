# Automatic checkpoint project binding

Goal: one DSH profile serves multiple projects without per-project configuration.

Architecture: resolve the trusted calling session cwd on every tool invocation.
Keep CheckpointWriter's fixed-root boundary checks. Automatic mode uses a recovery
base directory with a SHA-256 namespace derived from the filesystem canonical
target key. Existing explicit projectRoot/recoveryRoot retain their semantics.
No lifecycle autosave, task creation, or model-supplied path configuration.

Implementation plan:
1. Add automatic tool configuration; default adapter activation with false opt-out.
2. Resolve per-call roots before writer initialization, preserving error responses.
3. Test two projects, recovery isolation, missing/relative cwd, path argument rejection,
   default activation, opt-out, and existing explicit-root behavior.
4. Update installation documentation; run adapter tests, typecheck and package checks.

Tech stack: TypeScript, DSH ToolRuntime/FileSystem, node:test.
