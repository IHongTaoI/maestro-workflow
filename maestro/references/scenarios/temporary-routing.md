# Temporary Routing Scenarios

Use these behavioral scenarios when reviewing changes to Temporary Memory routing. `EXPECT` lists
required behavior; `MUST NOT` lists silent-routing failures.

## No active Temporary

```text
GIVEN: no active Temporary
USER: 帮我解释一下这个错误

EXPECT:
- Handle as a one-off request unless the discussion becomes worth preserving.

MUST NOT:
- Create Temporary Memory solely because no candidate exists.
```

## One related candidate

```text
GIVEN: one active topic "home startup performance"
USER: 继续看首页启动时的初始化阻塞

EXPECT:
- Select the existing Temporary because the module and failure are specifically related.
```

## One unrelated candidate

```text
GIVEN: one active topic "login performance"
USER: 我们讨论一下数据库备份策略

EXPECT:
- Treat this as a new topic.
- Create a Temporary only if the normal persistence rule requires it.

MUST NOT:
- Append to "login performance" merely because it is the only active Temporary.
```

## Explicit reference overrides binding

```text
GIVEN:
- Current Session is bound to "home startup performance".
- Another active Temporary has ID 20260831-登录性能 and topic "login performance".
USER: 继续 20260831-登录性能

EXPECT:
- Select "login performance" and replace the Session binding.

MUST NOT:
- Prefer the previous binding or the most recently updated candidate.
```

## Legacy ID remains usable

```text
GIVEN:
- A readable-ID Temporary "20260831-首页启动性能" exists from this naming rule.
- A second active Temporary uses the legacy timestamp-plus-suffix ID 20260827T103000Z-a1b2c3.
USER: 继续 20260827T103000Z-a1b2c3

EXPECT:
- Resolve the legacy ID to its Temporary (matching the directory name) exactly as an ID from the
  newer readable format.

MUST NOT:
- Reject or fuzzy-match a legacy ID because it predates the current naming rule.
```

## Invalid explicit ID

```text
GIVEN: the explicitly named Temporary ID is not active or does not exist
USER: 继续 20260827T000000Z-missing

EXPECT:
- Report that the requested Temporary is unavailable.

MUST NOT:
- Fuzzy-match the ID to another Temporary.
```

## Bound Session with vague continuation

```text
GIVEN:
- Current Session is bound to "home startup performance".
- Other performance-related Temporaries are active.
USER: 继续刚才那个性能问题

EXPECT:
- Continue the bound Temporary without rescanning full References.
```

## Clear departure from a bound topic

```text
GIVEN:
- Current Session is bound to "home startup performance".
- "database migration safety" and "database query performance" are also active.
USER: 先不看首页了，继续数据库那个问题

EXPECT:
- Do not use the old Session binding to decide the route.
- Ask which database topic the user means.

MUST NOT:
- Append the request to "home startup performance".
```

## Unique relevant candidate

```text
GIVEN:
- "home startup performance" has an Open question about synchronous SDK initialization.
- "login performance" concerns token refresh latency.
USER: 验证一下那个 SDK 是否必须同步初始化

EXPECT:
- Select "home startup performance" using the uniquely continued Open question.
- Be able to state the routing evidence if needed.
```

## Ambiguous candidates

```text
GIVEN:
- "home startup performance"
- "login performance"
USER: 继续之前的性能问题

EXPECT:
- Ask the user to choose from a short candidate list.
- Recency may determine display order only.

MUST NOT:
- Select the newest Temporary.
- Load either candidate's full references before selection.
```

## Similar topics remain separate

```text
GIVEN:
- "home startup performance"
- "homepage refactor"
USER: 回到首页那个事情

EXPECT:
- Ask which homepage topic the user means.

MUST NOT:
- Merge the Temporaries.
- Modify or archive either candidate while asking.
```
