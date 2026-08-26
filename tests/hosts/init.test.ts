import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeHost, verifyHostInstallation } from "../../src/hosts/init.ts";
import { runCapabilityProbes } from "../../src/runtime/probe-suite.ts";

const sourceSkillRoot = new URL("../../skills/maestro-workflow/", import.meta.url).pathname;

test("initializes the DSH Skill and project runtime contract together", async () => {
  const root = await mkdtemp(join(tmpdir(), "maestro-host-"));
  try {
    const installation = await initializeHost({ projectRoot: root, host: "dsh", sourceSkillRoot });
    assert.equal(installation.command, "npx --no-install maestro");
    assert.deepEqual(await verifyHostInstallation({ projectRoot: root, sourceSkillRoot }), {
      status: "installed",
      runtimeConfigured: true,
      skillPath: join(root, ".dsh", "skills", "maestro-workflow"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs all P01-P07 probes and fails closed", async () => {
  const report = await runCapabilityProbes({
    sourceSkillRoot,
    dshRunner: async () => ({ exitCode: 0, stdout: "dsh 0.1.1-rc.2", stderr: "" }),
  });
  assert.equal(report.status, "passed");
  assert.deepEqual(report.probes.map((probe) => probe.id), ["P01", "P02", "P03", "P04", "P05", "P06", "P07"]);
});
