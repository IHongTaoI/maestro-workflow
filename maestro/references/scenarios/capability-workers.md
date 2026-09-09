# Capability Worker Scenarios

Use these scenarios when reviewing Worker registries, capability resolution, generated Workers,
Task resumption, Handoffs, and authorization behavior.

## Exact project reuse

GIVEN: a project registry Worker covers `codebase-investigation`, `evidence-collection`, and
`runtime-analysis`

EXPECT:

- Resolve that project Worker as `exact`.
- Snapshot its complete specification before persisted execution.
- Present its task-specific Chinese display name to the user.

FORBID:

- Select a retired built-in fixed role.
- Persist a similarity score.

## Small composition

GIVEN: a delegation requires `architecture-design` and `runtime-analysis`, and no single active
project Worker covers both

EXPECT:

- Select the smallest safe set whose union covers both capabilities.
- Snapshot both specifications and keep each Worker's context and permissions separate.
- Use lexical Worker ID only after Worker count and unrelated capability count tie.

FORBID:

- Merge the Workers' conditional actions into wider authority.
- Create a preset coordinator role.

## Generate a Task-scoped Worker

GIVEN: a Task requires `react-performance`, `bundle-analysis`, and `runtime-profiling`, with no
safe project match

EXPECT:

- Generate one bounded Worker with `source: temporary`.
- Give it a concise task-specific Chinese display name and a schema-safe internal ID.
- Require a relevant `practice:*` instruction plus the Handoff and safety contracts.
- Set `lifecycle.scope: task`, the current Task ID, and `expires_at: task-completion`.
- Publish the validated specification directly as the immutable Task snapshot.

FORBID:

- Write into the installed Maestro Skill or add a permanent role.
- Automatically add the Worker to the project registry after completion.

## Generate a Temporary-scoped exploratory Worker

GIVEN: the user asks to analyze startup performance without requesting implementation, and the
investigation is worth preserving

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

- Infer authorization from the Worker specification, registry source, preferred model, or Handoff.

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

## Historical role snapshot

GIVEN: an older Task contains a valid role state path and a persisted `role:*` instruction digest

EXPECT:

- Validate and resume from the exact historical files when the old run must continue.
- Resolve any new follow-up from capabilities as a project or generated Worker.

FORBID:

- Move the old files, rewrite their instruction dependency, or select that fixed role for new work.

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
  practice instructions, Handoff contract, safety boundary, and only relevant context.
- Resolve every required instruction and record its source paths and SHA-256 digest.
- Cross-check the packet against the immutable Worker snapshot.
- Keep effective permissions within the intersection of snapshot, current work, host controls, and
  current authorization.

FORBID:

- Copy the complete parent Session history or rely on implicit Skill inheritance.
- Add write permission because the parent Agent could write.

## Missing required instruction

GIVEN: a Host Adapter cannot resolve or inject one required Worker instruction

EXPECT:

- Mark the delegation `unsupported` and name the unmet reference.
- Do not start the Worker.

FORBID:

- Substitute Old Zhou's full prompt or claim a degraded independent run.

## Host without enforceable subagent isolation

GIVEN: the current host has no native sub-agent mechanism that can enforce the packet boundary

EXPECT:

- Old Zhou may perform the bounded work directly when current authorization allows it.
- Report the result without claiming a Worker ran independently.

FORBID:

- Invent a sub-agent, background service, or isolation guarantee.

## Concise user handoff

GIVEN: a Worker completes with a valid Detailed Result and Handoff

EXPECT:

- Old Zhou checks the evidence and reports the result first.
- Include applicable verification, uncertainty, blocker, decision, or next step.

FORBID:

- Narrate routine file searches, commands, internal Worker IDs, or capability routing unless asked.
