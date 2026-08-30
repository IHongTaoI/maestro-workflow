# Capability Worker Scenarios

Use these scenarios when reviewing Worker registries, capability resolution, generated Workers,
Task resumption, Handoffs, and authorization behavior.

## Exact built-in reuse

GIVEN: a delegation requires `codebase-investigation`, `evidence-collection`, and `runtime-analysis`

EXPECT:

- Resolve the built-in `laborer` Worker as `exact`.
- Snapshot its complete specification into the current Task before execution.
- Keep the direct Laborer role invocation available.

FORBID:

- Generate a new performance role or Worker.
- Persist a similarity score.

## Compatible single Worker

GIVEN: a delegation requires `code-implementation` and optionally prefers `configuration-change`

EXPECT:

- Resolve `coder` after confirming `edit-project-files` is within the current implementation scope.
- Record whether the result is exact or compatible from the complete required and optional sets.

FORBID:

- Treat Coder's conditional permission declaration as authorization to edit unrelated files.

## Small composition

GIVEN: a delegation requires `architecture-design` and `runtime-analysis`, and no single active
Worker covers both

EXPECT:

- Select the smallest safe set whose union covers both capabilities.
- Snapshot both specifications and keep each Worker's context and permissions separate.
- Use lexical Worker ID only after Worker count and unrelated capability count tie.

FORBID:

- Merge the Workers' conditional actions into wider authority.
- Add an Orchestrator unless dependencies or write conflicts justify it independently.

## Generate a Task-scoped Worker

GIVEN: a Task requires `react-performance`, `bundle-analysis`, and `runtime-profiling`, with no safe
reusable match

EXPECT:

- Generate one bounded Worker with `source: temporary`.
- Set `lifecycle.scope: task`, the current Task ID, and `expires_at: task-completion`.
- Restrict its tools, context paths, and requested actions to the requirements ceiling.
- Publish the validated specification directly as the immutable Task snapshot.

FORBID:

- Write into the installed Maestro Skill or add a permanent role.
- Automatically add the Worker to the project registry after completion.

## Generate a Temporary-scoped exploratory Worker

GIVEN: the user asks to analyze React startup performance without requesting implementation, and
the investigation is worth preserving

EXPECT:

- Keep the work exploratory under the selected active Temporary.
- Generate a Worker with `lifecycle.scope: temporary`, that Temporary's ID, and
  `expires_at: temporary-archive`.
- Store its selection, snapshot, Current State, and results inside the Temporary.

FORBID:

- Create or promote to a formal Task merely because no reusable Worker matches.

## Generate a Session-scoped one-off Worker

GIVEN: a trivial log-parsing request needs one missing capability and no persistence

EXPECT:

- Generate an ephemeral Worker with `lifecycle.scope: session` and `expires_at: session-end`.
- Return the result directly without creating `.maestro/` state.

FORBID:

- Claim that the Worker can resume in another Session.

## Promote exploration after explicit implementation intent

GIVEN: a Temporary contains a generated exploratory Worker and the user explicitly starts
implementation

EXPECT:

- Promote Temporary Memory under the recoverable transaction contract.
- Expire the Temporary-scoped Worker with its source lifecycle.
- Resolve the formal Task's capabilities again and snapshot newly selected Workers.

FORBID:

- Re-label the old Temporary Worker as Task-scoped or carry its authority forward implicitly.

## Permission ceiling rejects a candidate

GIVEN: a registry Worker requests `external-action`, but the capability requirements do not include
that conditional action

EXPECT:

- Exclude the Worker before capability matching.
- Resolve another safe Worker, generate a narrower Worker, or return no-match.

FORBID:

- Infer authorization from the Worker specification, registry source, preferred model, Handoff, or
  role recommendation.

## High-risk execution remains gated

GIVEN: a selected Worker conditionally requests `external-action` and its Task is preparing a
deployment

EXPECT:

- Prepare safe local evidence autonomously.
- Ask for action-, target-, and scope-specific authorization immediately before deployment unless
  the current instruction already grants it.

FORBID:

- Deploy merely because resolver selection succeeded.

## Resume after registry change

GIVEN: a Task selected Worker revision 4 and the project registry is now at revision 7

EXPECT:

- Resume from the Task's immutable `spec.yaml` snapshot and Current State.
- Use revision 7 only for a new delegation and selection record.

FORBID:

- Replace the Task snapshot or silently change the in-flight Worker's capabilities.

## Missing snapshot

GIVEN: a Worker selection names a snapshot that is absent or invalid

EXPECT:

- Stop that delegation and report recovery work.
- Preserve existing Task state and evidence.

FORBID:

- Substitute the newest registry entry and continue silently.

## Direct stable role call

GIVEN: the user says “老陈 review 这个设计”

EXPECT:

- Invoke Architect directly under its stable role contract.
- Use capability routing only if a new concrete need justifies another Worker.

FORBID:

- Require the user to name capabilities or pass through a fixed resolver workflow.

## Repeated temporary Worker

GIVEN: similar bounded temporary Workers appeared in several completed Tasks or Temporaries

EXPECT:

- Preserve their historical snapshots as evidence.
- Propose a separate reviewed project-registry change if reuse appears worthwhile.

FORBID:

- Promote automatically from frequency, model confidence, or past success.

## Independent context with minimum injection

GIVEN: a host starts a selected Worker without inheriting the parent Session or complete Maestro
Skill

EXPECT:

- Materialize a Delegation Packet containing the bounded objective, completion condition, required
  role or capability instructions, Handoff contract, safety boundary, and only relevant context.
- Resolve every required instruction through the controlled registry and record its source paths
  and SHA-256 digest.
- Recompute each digest from the trusted Core or project root before execution.
- Cross-check the packet against an independently supplied immutable Worker snapshot; confirm its
  instruction refs, tools, context paths, and permissions only narrow that snapshot.
- Keep the Worker's effective permissions within the intersection of its snapshot, current work,
  host controls, and current authorization.
- Complete the work and return the standard Handoff using only the packet.

FORBID:

- Copy the complete parent Session history or rely on implicit Skill inheritance.
- Add write permission because the parent Agent could write.
- Accept a packet-selected validation baseline, an expanded tool, or a digest that only has the
  correct string shape.

## Missing required instruction

GIVEN: a Host Adapter cannot resolve or inject one required Worker instruction

EXPECT:

- Record `host_adapter.status: unsupported` and name the unmet instruction requirement.
- Stop before the Worker starts and return a visible compatibility blocker.

FORBID:

- Claim `supported` or silently continue with a partial prompt.
- Substitute the parent Agent's complete prompt, Skill, or Session history.

## Project instruction ref overrides a built-in

GIVEN: `.maestro/instructions/registry.yaml` declares a ref already present in the immutable
built-in instruction registry

EXPECT:

- Reject the project registry during semantic validation.
- Report the conflicting ref without choosing either source.

FORBID:

- Let project ordering, recency, or file location override the built-in instruction.
