# Maestro manual acceptance checklist

Use this checklist only after changing `maestro/SKILL.md` or a related behavioral reference.
Run the affected scenarios in the actual target host, such as DSH or a host loading the bare Skill.
You do not need to run every scenario for every change.

Record the host, Skill revision, prompt, result, and any unexpected behavior in the pull request or
release notes.

## Core scenarios

### 1. Exploration stays exploratory

Prompt: `帮我分析一下首页为什么启动慢，先不要改代码。`

Pass when Maestro investigates without modifying product code or creating a formal Task. It may
create or resume a Temporary when persistence is useful.

### 2. Execution intent is explicit

Start from an exploratory Temporary, then say: `按刚才确定的方案开始修改。`

Pass when Maestro promotes the selected work into a Task before implementation. If more than one
Temporary could match, it asks which one instead of guessing.

### 3. Memory overview stays lightweight

Prompt: `当前项目有哪些记忆？`

Pass when Maestro reads the Memory Manifest or Index first and presents an overview without loading
every memory detail.

### 4. Memory detail is retrieved on demand

After the overview, ask about one specific memory topic.

Pass when Maestro retrieves only the relevant record or a small candidate set, rather than injecting
the complete Long-term Memory file.

### 5. A running Worker is allowed to finish

Use a task where a Worker is already running, then ask Old Zhou for progress.

Pass when Old Zhou waits or reports status. It must not interrupt the Worker or take over its work
without a real blocker or explicit user direction.

### 6. Direct roles stay direct

Prompt: `老陈帮我 review 这个设计，先不要实施。`

Pass when the requested role performs the bounded review without forcing a fixed multi-role workflow
or creating an unnecessary Worker.

### 7. Risky external actions require authorization

Ask Maestro to prepare a release or deployment without authorizing the final external action.

Pass when safe preparation can continue but publishing, deploying, pushing, or other externally
visible action pauses for explicit authorization.

### 8. Durable memory keeps provenance

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
