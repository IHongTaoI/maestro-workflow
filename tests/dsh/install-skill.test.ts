import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  installProjectSkill,
  ProjectSkillConflictError,
  projectSkillTarget,
  verifyProjectSkill,
} from "../../src/dsh/install-skill.ts";

const sourceSkillRoot = fileURLToPath(new URL("../../skills/maestro-workflow/", import.meta.url));

async function withProject(run: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), "maestro-v3-project-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("installs the bundled DSH Skill into the project-local discovery path", async () => {
  await withProject(async (projectRoot) => {
    const result = await installProjectSkill({ projectRoot, sourceSkillRoot });

    assert.deepEqual(result, { status: "installed", targetPath: projectSkillTarget(projectRoot) });
    const installedSkill = await readFile(join(projectSkillTarget(projectRoot), "SKILL.md"), "utf8");
    assert.match(installedSkill, /^---\nname: maestro-workflow\n/m);
    assert.deepEqual(await verifyProjectSkill({ projectRoot, sourceSkillRoot }), {
      status: "installed",
      targetPath: projectSkillTarget(projectRoot),
    });
  });
});

test("is idempotent when every installed file is byte-identical", async () => {
  await withProject(async (projectRoot) => {
    await installProjectSkill({ projectRoot, sourceSkillRoot });
    assert.deepEqual(await installProjectSkill({ projectRoot, sourceSkillRoot }), {
      status: "unchanged",
      targetPath: projectSkillTarget(projectRoot),
    });
  });
});

test("refuses to replace a user-modified project Skill without force", async () => {
  await withProject(async (projectRoot) => {
    await installProjectSkill({ projectRoot, sourceSkillRoot });
    const target = projectSkillTarget(projectRoot);
    await writeFile(join(target, "SKILL.md"), "user customization", "utf8");

    await assert.rejects(
      () => installProjectSkill({ projectRoot, sourceSkillRoot }),
      (error: unknown) => error instanceof ProjectSkillConflictError && error.targetPath === target,
    );
    assert.deepEqual(await verifyProjectSkill({ projectRoot, sourceSkillRoot }), {
      status: "modified",
      targetPath: target,
    });
  });
});

test("replaces a modified target only with explicit force", async () => {
  await withProject(async (projectRoot) => {
    await installProjectSkill({ projectRoot, sourceSkillRoot });
    const target = projectSkillTarget(projectRoot);
    await writeFile(join(target, "SKILL.md"), "user customization", "utf8");

    assert.deepEqual(await installProjectSkill({ projectRoot, sourceSkillRoot, force: true }), {
      status: "installed",
      targetPath: target,
    });
    assert.match(await readFile(join(target, "SKILL.md"), "utf8"), /^---\nname: maestro-workflow\n/m);
  });
});
