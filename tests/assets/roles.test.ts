import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const skillRoot = new URL("../../skills/maestro-workflow/", import.meta.url);
const roles = ["tpm", "architect", "planner", "coder", "tester"] as const;

test("ships Lao Zhou and every MVP role as DSH skill assets", async () => {
  const skill = await readFile(new URL("SKILL.md", skillRoot), "utf8");
  assert.match(skill, /^---\nname: maestro-workflow\n/m);
  assert.match(skill, /todo_write/);
  assert.match(skill, /npm run --silent maestro -- compile-task-graph/);
  assert.match(skill, /create-task/);
  assert.match(skill, /prepare-task-run/);
  assert.match(skill, /record-task-run/);
  assert.match(skill, /workflow/);

  for (const role of roles) {
    const content = await readFile(new URL(`roles/${role}.md`, skillRoot), "utf8");
    assert.match(content, /^# /m);
    assert.match(content, /JSON/);
  }
});
