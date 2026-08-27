# Playbooks

Playbooks are optional project-authored guidance stored under `.maestro/playbooks/` as Markdown or
YAML. They may suggest roles, checks, evidence, or typical sequencing.

When a user asks to follow a Playbook:

1. Read the named Playbook. If none is named, select one only when its purpose clearly matches.
2. Explain any material implication that affects scope, cost, risk, or external actions.
3. Adapt its recommendations to the current task and available evidence.
4. Follow the user's current instruction when it conflicts with optional Playbook guidance, unless
   doing so would violate a safety or authorization boundary.

Do not turn Playbook sections into mandatory Runtime states. Skip irrelevant roles and insert a
needed role when current evidence justifies it. The user may change the path at any time.

Do not modify a project-authored Playbook unless the user asks to update it.
