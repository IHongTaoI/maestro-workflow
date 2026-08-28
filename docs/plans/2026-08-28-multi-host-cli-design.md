# Multi-host CLI MVP Design

## Decision

Maestro v0.1.0 will be distributed as an npm-installed command-line tool that installs the
portable Maestro Skill into project-local directories understood by different AI coding hosts.
The CLI is a deterministic packaging and adapter layer; it does not schedule roles, execute a
workflow, or interpret Memory. Those semantics remain in `maestro/SKILL.md` and its references.

The first release supports three explicit targets: Codex through `.agents/skills/maestro/`, Claude
Code through `.claude/skills/maestro/`, and OpenCode through
`.opencode/skills/maestro/`. A user can select targets interactively or pass
`--tools codex,claude,opencode` for automation. New hosts are added as data in a registry rather
than by copying orchestration logic.

## Package and Commands

The npm package contains the canonical `maestro/` Skill directory plus a zero-runtime-dependency
Node.js CLI. `package.json` exposes `maestro` through the `bin` field. The initial command surface
is deliberately small:

- `maestro init [path]`: select targets, install the Skill, and record local installation metadata.
- `maestro update [path]`: refresh targets previously managed by the CLI.
- `maestro doctor [path]`: verify metadata, managed markers, and required Skill files.
- `maestro --version`: print the installed package version.

`init` refuses to overwrite a non-empty, unmanaged destination unless the user passes `--force`.
Every installed target gets a `.maestro-managed.json` ownership marker. Project-local selection is
stored in `.maestro/installation.json`, which is runtime configuration and remains excluded from
Git by the existing `.gitignore` contract.

## Installation and Update Flow

The packaged `maestro/` directory is the single source of generated Skill content. Installation
copies that directory into each selected host destination and adds only the ownership marker.
Existing CLI-managed destinations can be refreshed idempotently; unknown files are preserved so an
update cannot silently delete user-authored content. `update` reads the saved tool selection and
does not prompt. Adding another host is done by running `init` again with the additional selection.

The CLI detects likely hosts from existing `.agents`, `.codex`, `.claude`, and `.opencode`
directories and uses those as interactive defaults. Non-interactive sessions must supply
`--tools`; this avoids a hung CI process. A shared error model returns exit code 0 for success, 1
for invalid configuration or failed diagnostics, and 2 for command usage errors.

## Verification and Boundaries

Node's built-in test runner exercises argument parsing, all three destinations, repeatable updates,
unmanaged-directory protection, and doctor failure/success behavior in temporary projects. The
existing contract suite continues to validate schemas and Markdown links. CI runs both suites and
an npm pack smoke test to prove that the published tarball contains the CLI and full Skill package.

The MVP intentionally excludes a background service, global project registry, automatic npm
publication, host APIs, slash-command generation, Memory execution, and migration of legacy
Maestro runtimes. Those can be added only when a concrete host requires them. This preserves the
Core/Adapter boundary: TypeScript or JavaScript performs reliable file operations, while the Skill
continues to make all semantic collaboration decisions.
