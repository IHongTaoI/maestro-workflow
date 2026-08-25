import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { parseCliArguments, runCli, type CliIo } from "../src/cli.ts";

type CapturedIo = CliIo & { stdout: string; stderr: string };

function captureIo(): CapturedIo {
  let stdout = "";
  let stderr = "";
  return {
    get stdout() { return stdout; },
    get stderr() { return stderr; },
    writeStdout: (message) => { stdout += message; },
    writeStderr: (message) => { stderr += message; },
  };
}

async function withTemporaryProject(run: (projectRoot: string) => Promise<void>): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), "maestro-v3-cli-"));
  try {
    await run(projectRoot);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

test("parses only the supported commands and options", () => {
  assert.deepEqual(parseCliArguments(["compile-task-graph", "--file", "planning/task-graph.yaml"], "C:/repo"), {
    command: "compile-task-graph",
    filePath: resolve("C:/repo", "planning/task-graph.yaml"),
  });
  assert.deepEqual(parseCliArguments(["install-dsh-skill", "--project", "C:/project", "--force"], "C:/repo"), {
    command: "install-dsh-skill",
    projectRoot: resolve("C:/project"),
    force: true,
  });
  assert.throws(() => parseCliArguments(["install-dsh-skill", "--file", "graph.yaml"]), /does not support --file/);
});

test("compiles a task graph to a workflow request without launching DSH", async () => {
  await withTemporaryProject(async (projectRoot) => {
    const graphPath = join(projectRoot, "tpm.yaml");
    await writeFile(graphPath, `name: tpm-smoke\ntasks:\n  - id: tpm-smoke\n    role: tpm\n    description: Inspect the requested scope.\n`);
    const io = captureIo();

    const exitCode = await runCli(["compile-task-graph", "--file", graphPath], io);

    assert.equal(exitCode, 0);
    assert.equal(io.stderr, "");
    const request = JSON.parse(io.stdout) as { meta: { name: string }; args: { graphName: string } };
    assert.equal(request.meta.name, "maestro-tpm-smoke");
    assert.equal(request.args.graphName, "tpm-smoke");
  });
});

test("installs and verifies the project-local DSH Skill through the CLI", async () => {
  await withTemporaryProject(async (projectRoot) => {
    const installIo = captureIo();
    assert.equal(await runCli(["install-dsh-skill", "--project", projectRoot], installIo), 0);
    assert.deepEqual(JSON.parse(installIo.stdout), {
      status: "installed",
      targetPath: join(projectRoot, ".dsh", "skills", "maestro-workflow"),
    });

    const verifyIo = captureIo();
    assert.equal(await runCli(["verify-dsh-skill", "--project", projectRoot], verifyIo), 0);
    assert.deepEqual(JSON.parse(verifyIo.stdout), {
      status: "installed",
      targetPath: join(projectRoot, ".dsh", "skills", "maestro-workflow"),
    });
  });
});

test("makes a modified project Skill observable to CI through a nonzero verify status", async () => {
  await withTemporaryProject(async (projectRoot) => {
    assert.equal(await runCli(["install-dsh-skill", "--project", projectRoot], captureIo()), 0);
    await writeFile(join(projectRoot, ".dsh", "skills", "maestro-workflow", "SKILL.md"), "modified by user\n");
    const io = captureIo();

    assert.equal(await runCli(["verify-dsh-skill", "--project", projectRoot], io), 1);
    assert.equal(JSON.parse(io.stdout).status, "modified");
  });
});
