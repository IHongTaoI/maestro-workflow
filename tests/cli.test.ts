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
  assert.deepEqual(parseCliArguments(["create-task", "--task", "health", "--file", "planning/task-graph.yaml"], "C:/repo"), {
    command: "create-task",
    taskId: "health",
    projectRoot: resolve("C:/repo"),
    filePath: resolve("C:/repo", "planning/task-graph.yaml"),
  });
  assert.deepEqual(parseCliArguments(["prepare-task-run", "--task", "health", "--memory", "retry database"], "C:/repo"), {
    command: "prepare-task-run",
    taskId: "health",
    projectRoot: resolve("C:/repo"),
    memoryQuery: ["retry database"],
  });
  assert.deepEqual(parseCliArguments(["resume-task-run", "--task", "health"], "C:/repo"), {
    command: "resume-task-run",
    taskId: "health",
    projectRoot: resolve("C:/repo"),
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

test("creates, prepares, records, revises, and queries a durable task through the CLI", async () => {
  await withTemporaryProject(async (projectRoot) => {
    const graphPath = join(projectRoot, "health.yaml");
    await writeFile(graphPath, `name: health-delivery\ntasks:\n  - id: requirements\n    role: tpm\n    description: Define the health command.\n`);

    const createIo = captureIo();
    assert.equal(await runCli(["create-task", "--project", projectRoot, "--task", "health", "--file", graphPath], createIo), 0);
    assert.equal(JSON.parse(createIo.stdout).status, "ready");

    const prepareIo = captureIo();
    assert.equal(await runCli(["prepare-task-run", "--project", projectRoot, "--task", "health"], prepareIo), 0);
    assert.equal(JSON.parse(prepareIo.stdout).args.taskContext.taskId, "health");

    const resumeIo = captureIo();
    assert.equal(await runCli(["resume-task-run", "--project", projectRoot, "--task", "health"], resumeIo), 0);
    assert.deepEqual(JSON.parse(resumeIo.stdout), JSON.parse(prepareIo.stdout));

    const resultPath = join(projectRoot, "workflow-result.json");
    await writeFile(resultPath, JSON.stringify({
      graph: "health-delivery",
      tasks: { requirements: { summary: "The health command is read-only.", artifacts: [], blockers: [] } },
    }));
    const recordIo = captureIo();
    assert.equal(await runCli(["record-task-run", "--project", projectRoot, "--task", "health", "--file", resultPath], recordIo), 0);
    assert.equal(JSON.parse(recordIo.stdout).task.status, "completed");

    const memoryIo = captureIo();
    assert.equal(await runCli(["query-memory", "--project", projectRoot, "--query", "health"], memoryIo), 0);
    assert.equal(JSON.parse(memoryIo.stdout).length, 1);

    const reviseIo = captureIo();
    assert.equal(await runCli(["revise-task", "--project", projectRoot, "--task", "health", "--file", graphPath], reviseIo), 0);
    assert.equal(JSON.parse(reviseIo.stdout).revision, 2);
  });
});
