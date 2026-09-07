# Recoverable checkpoint: M1 contract and DSH evidence

Status: **proposed implementation contract; checkpoint is not activated**.
Scope: the first implementation increment for [#26](https://github.com/IHongTaoI/maestro-workflow/issues/26), within [#14](https://github.com/IHongTaoI/maestro-workflow/issues/14).
Audited on 2026-09-07 against installed DSH `0.1.1-rc.2` declarations and the adapter lockfile.

## Evidence and capability boundary

Reproduce from the repository root:

```sh
node adapters/deepseek-harness/scripts/audit-checkpoint.mjs
```

The script reads installed package declarations, not a live Harness. It reports versions,
lockfile agreement, source lines and SHA-256 hashes. A successful audit proves only that the
selected declarations exist. Upgrades require re-reading their semantics, not merely passing
the string scan. Upstream package provenance is `deepseek-ai/deepseek-harness`, recorded in
each installed package's `package.json` repository field.

Paths below are relative to `adapters/deepseek-harness/node_modules/@deepseek-ai/`.

| Seam | Versioned declaration evidence | Maestro state / implementation consequence |
| --- | --- | --- |
| Bounded Session input | `dsh-session/lib/types/index.d.ts`: `Session.events` is an immutable array snapshot; `Session.seq` is the NEXT event number | Available in installed types, live service unverified; no source capture wired. Use a captured array and an exclusive `end_seq`, not a moving live upper bound. |
| Durability barrier | Same file: `SessionStore.flush(session): Promise<boolean>` awaits participating listeners; false means none participated; errors propagate after listeners settle | Not a persistence implementation. The file explicitly describes an in-memory store and persistence plugins. No durable reread or independent failure store has been verified. |
| Lifecycle | `dsh-agent/lib/types/runtime-types.d.ts`: session-start is emit; pre-step is waterfall; turn-stopping is awaited serial | Adapter has a turn-stopping helper but does not mount a handler. Emit is not an awaited save barrier; turn-stopping is not Session End or pre-compaction. |
| Next-step context | Same file: `Agent.inject` queues context without waking, may miss an already claimed pre-step and may be discarded on cancellation | Candidate recovery mechanism only; no guarantee of immediate or persistent injection. |
| Native agent creation | `dsh-agent/lib/types/index.d.ts`: factory creation and scoped setup | Registry needs an installed factory. No Maestro Worker Packet / tools / permission mapping exists; fresh context cannot supply missing parent facts. M1 uses the current Agent. |
| Dynamic prompt | `dsh-system-prompt/lib/types/index.d.ts`: section/context providers evaluated per assembly | Declaration present, Maestro provider not registered. A complete prompt section can override ordinary sections; actual model inclusion requires integration verification. |
| Guarded state store | Repository `src/storage.ts`: containment, snapshot, guarded replacement, exclusive create and lock leases | Internal Cordis service exists; no model-facing checkpoint tool. FsVersion is a host token, distinct from Core revision. |
| Validation | Repository `src/validate.ts`: loaded Core JSON Schemas | Internal service exists. No checkpoint envelope schema yet; Markdown/frontmatter and semantic checks need explicit implementation. |
| Tool execution | No tool-executor registration in current Adapter entry point; prompt tool schemas alone do not execute tools | Exact runtime tool registry / profile is still a prerequisite for the next PR. Do not invent a `ctx.tools` API from other hosts. |
| Context pressure / pre-compaction | No verified pressure meter or awaited pre-compaction contract in this audit | Unknown, not proven globally absent. M2 must inspect the actual compaction/profile packages. The `compact` session-start source is not proof of a pre-compaction hook. |

The locked interface packages do not establish an installed, runnable DSH profile with a
model provider, tool executor and persistence backend. M1's live acceptance remains open.
`ctx.get('sessionPersistence') !== undefined` alone cannot establish durable coverage,
retention, read permissions or recovery while `.maestro/` storage is unavailable.

## Core and Adapter ownership

Core selects the current work from user intent, decides what is worth saving and supplies
the bounded summary. Adapter captures/verifies sources, validates the packet, serializes
writes and reports outcomes. A checkpoint never promotes Temporary to Task, approves
Long-term memory, changes a Playbook or expands current authorization.

This document is outside the active Skill on purpose. Proposed metadata below becomes an
active protocol only when schemas, semantic validators and the writer/reader are delivered
together. Existing [memory](../../maestro/references/memory.md) and
[storage](../../maestro/references/storage.md) rules remain authoritative meanwhile.

## M1 target and input

Explicit save/handoff requests start M1. Resolve one existing active target first; ambiguous
or missing targets return `needs_target`. Do not auto-create state to make a checkpoint work.

| Work | One mutable destination per request |
| --- | --- |
| Temporary | `.maestro/memory/temporary/active/<id>/current.md` |
| Task-level progress | `.maestro/tasks/<id>/progress.md` |
| Worker-level progress | Existing selected Worker's `current-state.md` inside that Task/Temporary; validate ownership, do not infer arbitrary paths |

Do not introduce `.maestro/tasks/<id>/current.md`. Preserve unrelated content and existing
revision frontmatter. If the requested change also requires metadata/catalog/lifecycle
updates to maintain an invariant, narrow the request or use the existing multi-file transaction
protocol; never claim a sequence of independent writes is atomic. Catalog refresh follows
formal commit and must not roll it back.

The request carries schema version, stable request ID, normalized project/target binding,
base Core revision, source descriptor and bounded replacement proposal. Runtime target handles
and host freshness tokens remain Adapter-owned; the model cannot supply a trusted snapshot.

Source descriptor alternatives:

- `session_events`: host/session identity, immutable captured interval `[start_seq, end_seq)`,
  hash of captured lossless-JSON input, selected evidence refs and a durable reread locator.
  `Session.seq` is exclusive; for an empty log it is zero. Event position is not a model
  token percentage or a Core revision. Capture once before asynchronous summarization.
- `snapshot`: immutable bounded source file under the selected target's `references/`,
  its SHA-256 and an explicit origin. This records what the current Agent supplied; it cannot
  prove that all original conversation facts were included. Persist before claiming retryability.

An interval describes input examined, not proof of perfect summarization. Record omitted or
unprocessed ranges; never silently truncate and claim coverage through the original end.
Large tool bodies should use reachable artifacts where useful. Avoid saving credentials or
unrelated sessions. If the required source exceeds the configured byte/event budget, split
into explicit requests or fail visibly instead of dropping data.

For DSH durable source mode, capture the selected prefix, await the participating flush barrier,
then verify that the backend can reread that prefix with matching identity/hash. A successful
flush alone does not prove retention or independent storage. Cancellation, false return or
failed reread leaves durable recovery unverified.

## Proposed recovery records and commit authority

Use recovery metadata inside the selected target, not a fourth Memory layer:

```text
<target>/references/checkpoints/<request-id>/
  request.json       # immutable binding, base revision, source and intended result hash
  source.json        # optional immutable bounded snapshot, when source mode requires it
  proposal.md        # immutable complete replacement bytes, including commit receipt
  events/<id>.json   # immutable failed-attempt / committed / superseded observations
```

Use schema-validated filesystem-safe IDs and canonical containment for every path. Publish
complete files exclusively; never replace an immutable request with different content. Prepare
source and proposal first, then publish `request.json` last as the ready marker. Orphaned
preparation files are not runnable. Do not delete them as part of ordinary recovery.

These are proposed formats, not files already recognized by current validators. Next PR adds
envelope/event schemas, target-aware Markdown checks and fixtures. Do not pass arbitrary
Markdown to a JSON Schema validator and call it validated.

The atomic replacement of the ONE current-state destination is the checkpoint's commit point.
Include a proposed `checkpoint_receipt` in its frontmatter: request ID, source identity/hash,
coverage boundary and committed Core revision. The immutable request records the SHA-256 of
the exact proposed bytes. The receipt and summary land together, so success does not depend on
a second mutable pending flag write. This is not the `storage.md` multi-file transaction protocol.

Before publication, validate replacement content, receipt and `base_revision + 1` together.
Use the Core lock/revision protocol plus host CAS, reread and verify the committed bytes. While
holding the target lock, write a committed observation to its request record. Only then admit
another checkpoint for the target. On failure to persist that observation, reconcile the target
receipt before any later checkpoint can replace it.

Recovery of a request after lost confirmation:

- Target bytes match the intended hash and receipt: already committed; reconstruct observation,
  return the existing revision, do not write the summary again.
- A matching committed observation exists: validate it against the immutable request. It proves
  this request completed, not that it covers later target edits.
- Target still matches the recorded base revision AND base content hash: retry guarded commit
  after lifecycle/source/authorization checks.
- Target differs from both base and intended state, including a matching revision but different
  content: conflict. Never infer success from timestamps or force old content over new work.

A later unrelated writer that removed the receipt before observation repair can leave the
result ambiguous. Report that ambiguity; supporting arbitrary nonparticipating writers with
exactly-once guarantees is not an M1 claim.

## Pending, failures and concurrency

`pending` is derived from a ready request without a verified commit or explicit supersession.
There is no independently authoritative mutable `memory_pending` Boolean. Runtime context can
display a derived Boolean plus affected request IDs and source ranges. A failed attempt leaves
the request pending; successful resolution of one request does not clear newer requests.

Idempotency uses the stable request ID plus immutable payload identity. Same ID/different
payload is an error. Coalesce a repeated trigger for the same target/source/proposal; newer
source input must receive its own request. Same source can yield a changed proposal after a
conflict; explicitly supersede the old request and rebase rather than mutating its envelope.

Allow only one active checkpoint writer per target, with bounded lock waiting. An expired
lease is not proof of owner death. Recheck target lifecycle and Core revision after acquiring
the lock; coordinate with the existing lifecycle write protocol. Refuse an operation requiring
multiple locks/invariants until its transaction path is implemented.

Failure to summarize, validation errors, cancellation and CAS conflicts all return explicit
outcomes. If `.maestro/` writes fail before the ready request exists, recovery requires an
independent durable backend containing BOTH the source and request-to-target binding. A session
log containing only conversation text cannot reconstruct an unsaved intended destination.
The Adapter must verify this independent channel before promising automatic retry. If every
durable channel fails, return `unrecoverable` with the unsaved coverage range; a console message
is visibility, not persistence. M1 may initially expose manual retry without claiming stronger
failure recovery; #26 stays open until its accepted recovery scenarios are demonstrated.

## Resume behavior

Resolve work from the new request, validate target lifecycle and current authorization, then
follow Core catalog freshness and bounded retrieval. Load current state and relevant request
records, compare source boundaries and pending status, and reload detailed Skill/references as
needed. Saved input through N does not cover new work after N. Do not automatically resume
an unrelated target after clear, merge across Sessions, or treat historical permissions as current.

## Next implementation and acceptance gates

1. Verify an actual DSH profile's model-facing tool executor and persistence read/write API,
   including independent recovery storage. Record exact versions and callable signatures.
2. Add checkpoint envelope/event schemas and semantic checks with positive/negative fixtures;
   update active Core storage/memory docs in the same change that introduces the implementation.
3. Add a single-target writer and recovery reader using existing store/validator services.
   Bind project, Session and permissions from trusted execution context, not model parameters.
4. Register the actual tool; run real DSH save, process exit and fresh-session resume. Keep
   capability availability separate from successfully activated and verified behavior.

Required writer tests: success and no-op retry; reused ID with changed payload; new input while
save runs; target conflict; invalid Markdown/envelope; interrupted preparation; commit succeeds
but observation fails; target archived before retry; source expired; main storage failure with
independent recovery; both stores unavailable. Assertions inspect persisted bytes/revisions and
recoverability, not only result labels. Include a nonparticipating-writer ambiguity case.

Live acceptance must record actual tool calls, selected destination, source boundary, committed
revision, fresh-session recovery and an induced storage failure. Do not check off live acceptance
using declaration scans, mock flush listeners or Codex's existing recovery reminder.

M2 pressure thresholds/pre-compaction and M3 independent Worker/per-step prompt providers remain
separate work. No 70–75% threshold is claimed safe by this contract.
