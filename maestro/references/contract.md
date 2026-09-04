# Maestro Skill Contract

Use this Reference when a Host Adapter, role, or Worker must interpret or expose Maestro's common
input and output semantics. This is an Agent behavior contract, not a Runtime API. It does not
require JSON output, persistent state, or delegation for ordinary requests.
Do not load it for ordinary user-facing introductions to Maestro, a role, or how Maestro works.

## Input contract

Only `user_request` is always required. Every other input is optional and loaded only when the
current step needs it:

| Input | Meaning |
| --- | --- |
| `user_request` | The current request, including explicit constraints and implementation intent. |
| `project_context` | The smallest relevant project files, facts, and current work state. |
| `memory_context` | A Manifest, current record, or bounded retrieval result; never all Memory by default. |
| `available_capabilities` | Tools, roles, sub-agents, models, and isolation the Host can actually provide. |
| `authorization_context` | Actions, targets, and scope explicitly authorized by the current request. |

An unavailable optional input stays unavailable. Do not invent it, load unrelated history to fill
it, or treat the absence of a capability as permission to simulate a successful independent run.

## Output contract

Return only the smallest result needed for the current step. Results may be combined when one step
genuinely produces more than one of them:

- `direct_response`: the answer or bounded work result returned directly to the user.
- `delegation_request`: a bounded objective, completion condition, minimum context, tools,
  permissions, lifecycle, output paths, and Handoff expectation.
- `task_or_temporary_proposal`: a proposed persistence or lifecycle transition with its reason.
- `memory_update_proposal`: a sourced candidate for independent review; it does not mutate Memory.
- `blocked_result`: the blocker, already completed work, and the smallest question or requirement
  needed to continue.
- Standard Detailed Result, Current State, or Handoff when their dedicated contract applies.

A proposal never approves itself or grants execution authority. Output cannot expand the user's
authorization, the selected work scope, a Worker's specification, or filesystem boundaries.

## Host behavior

Map this semantic contract to the Host's native conversation, filesystem, tool, and sub-agent
interfaces. Do not force a structured envelope when natural language is sufficient. When the Host
cannot inject a required instruction, enforce a boundary, recover a delegated run, or provide a
required capability, return an explicit `degraded` or `unsupported` result as defined by the
relevant Reference. Never claim that unavailable isolation or delegation occurred.

This Contract does not override Progressive Disclosure. A small one-off still uses Core only, and a
direct role request still loads only that role's Reference unless the current step separately needs
this Contract.
