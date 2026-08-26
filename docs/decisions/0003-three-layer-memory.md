# ADR-0003: V3 separates temporary, task and project Wiki memory

- Status: accepted
- Date: 2026-08-26

## Context

The DSH MVP stored one generated summary per completed run and searched all summaries with a global
substring match. That mixed unconfirmed discussion, role working state and durable project truth,
and it could not trace retrieved excerpts back to evidence.

## Decision

V3 has three independently governed layers:

- Drafts are unconfirmed and are never injected as facts.
- Task memory contains immutable run evidence and compact per-role current state with history.
- The project LLM Wiki contains explicitly promoted, versioned conclusions linked to source Memory IDs.

Retrieval is explicit and bounded. Task and role filters apply before scoring; Wiki and role context
are selected separately for each Agent. Current summaries include a coverage cursor and source hash.

## Consequences

Task completion does not automatically rewrite project truth. Promotion requires an intentional
command and evidence. The file model remains portable and Git-auditable without requiring a vector
database or remote service.
