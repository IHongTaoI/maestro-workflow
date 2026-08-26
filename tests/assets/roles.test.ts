import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillRoot = new URL("../../skills/maestro-workflow/", import.meta.url);
const roles = ["tpm", "laborer", "architect", "orchestrator", "coder", "test-designer", "test-runner", "delivery", "planner", "tester"] as const;

test("ships Lao Zhou and every MVP role as DSH skill assets", async () => {
  const skill = await readFile(new URL("SKILL.md", skillRoot), "utf8");
  assert.match(skill, /^---\nname: maestro-workflow\n/m);
  assert.match(skill, /todo_write/);
  assert.match(skill, /npx --no-install maestro compile-task-graph/);
  assert.match(skill, /create-task/);
  assert.match(skill, /prepare-task-run/);
  assert.match(skill, /record-task-run/);
  assert.match(skill, /workflow/);
  assert.match(skill, /Maestro 模式禁止调用 `create_goal`/);
  assert.match(skill, /waiting_for_delegates/);
  assert.match(skill, /不得用“不等了，我来做”/);
  assert.match(skill, /Diagnosis 模式/);
  assert.match(skill, /禁止生成 `npx --no-install node/);
  assert.match(skill, /新图只使用以下规范字段/);

  const orchestrator = await readFile(new URL("roles/orchestrator.md", skillRoot), "utf8");
  assert.match(orchestrator, /不得输出 `version`/);
  assert.match(orchestrator, /不得输出 `title`/);
  assert.match(orchestrator, /compile-task-graph/);

  for (const role of roles) {
    const content = await readFile(new URL(`roles/${role}.md`, skillRoot), "utf8");
    assert.match(content, /^# /m);
    assert.match(content, /JSON/);
  }
});
