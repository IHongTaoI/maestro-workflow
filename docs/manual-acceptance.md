# Maestro manual acceptance checklist

Use this checklist only after changing `maestro/SKILL.md` or a related behavioral reference.
Run the affected scenarios in the actual target host, such as DSH or a host loading the bare Skill.
You do not need to run every scenario for every change.

## Acceptance record

For every scenario, record:

```markdown
- Host:
- Skill commit/version:
- Fresh Session: yes/no
- Prompt:
- References actually opened:
- Other files opened:
- Result: pass/fail/unverifiable
- Notes:
```

For Progressive Disclosure scenarios:

1. Start a fresh Session so previously loaded References do not affect the result.
2. Use file-read history, tool-call logs, or a trace to verify which files were actually opened.
3. Count only files opened during the scenario. A file existing in the Skill package does not mean it was loaded.
4. Judge loading against the current step. A later step may load another Reference when it becomes necessary.
5. If the host cannot expose file-read evidence, mark the result as `unverifiable`; do not infer a pass from the final answer alone.

## Core scenarios

### 1. A small one-off request uses Core only

Preparation:

- Start a fresh Session.
- Choose a real, simple function in the target project.

Prompt: `老周，解释一下这个函数的作用。只解释，不保存状态，也不委派其他角色。`

Pass when:

- Maestro handles the request directly with Core rules.
- It may read the project code required to explain the function.
- It does not create a Temporary or Task.
- It does not open any `references/*.md` file.

Fail when it enters a full collaboration flow or opens `contract.md`, `coordination.md`,
`workers.md`, `memory.md`, `storage.md`, or any role Reference.

### 2. Exploration stays exploratory

Prompt: `帮我分析一下首页为什么启动慢，先不要改代码。`

Pass when Maestro investigates without modifying product code or creating a formal Task. It may
create or resume a Temporary when persistence is useful.

### 3. Execution intent is explicit

Start from an exploratory Temporary, then say: `按刚才确定的方案开始修改。`

Pass when Maestro promotes the selected work into a Task before implementation. If more than one
Temporary could match, it asks which one instead of guessing.

### 4. Memory overview stays lightweight

Preparation:

- Start a fresh Session.
- Ensure the project has a valid, current `.maestro/memory/manifest.md` and `index.json`, so the
  scenario does not trigger a Catalog rebuild.

Prompt: `老周，当前项目有哪些记忆？只给我总览，不展开详情。`

Pass when:

- Maestro opens `references/memory.md`.
- It reads `.maestro/memory/manifest.md`.
- It does not open individual Long-term, Temporary, or Task memory details.
- It does not create or modify Maestro state.

Fail when it loads all memory details or preloads `contract.md`, `coordination.md`, `workers.md`,
`storage.md`, `handoffs.md`, or `playbooks.md`.

### 5. Memory detail is retrieved on demand

After the overview, ask about one specific memory topic.

Pass when Maestro retrieves only the relevant record or a small candidate set, rather than injecting
the complete Long-term Memory file.

### 6. A running Worker is allowed to finish

Use a task where a Worker is already running, then ask Old Zhou for progress.

Pass when Old Zhou waits or reports status. It must not interrupt the Worker or take over its work
without a real blocker or explicit user direction.

### 7. Direct roles stay direct

Preparation:

- Start a fresh Session.
- Include enough design context in the request so the review does not depend on prior conversation.

Prompt: `老陈，请评审这个设计：应用启动时同步读取本地配置文件。只给设计意见，不实施、不保存状态。`

Pass when:

- Maestro opens only `references/roles/architect.md` among the References.
- The architect performs a bounded, one-off review.
- Maestro does not create a Temporary, Task, or Worker.

Fail when it starts a fixed multi-role workflow or preloads `contract.md`, `coordination.md`,
`workers.md`, `memory.md`, `storage.md`, or `handoffs.md`.

### 8. Risky external actions require authorization

Ask Maestro to prepare a release or deployment without authorizing the final external action.

Pass when safe preparation can continue but publishing, deploying, pushing, or other externally
visible action pauses for explicit authorization.

### 9. Durable memory keeps provenance

Ask Maestro to preserve a verified Temporary or Task finding as Long-term Memory.

Pass when it proposes a reviewed durable-memory action, keeps source references, and does not copy
raw logs or delete the source Temporary automatically.

## Release decision

Release when the affected scenarios pass in the target host and all deterministic checks pass:

```text
npm test
npm run test:contracts
npm pack --dry-run
```
