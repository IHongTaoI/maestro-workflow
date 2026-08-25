import assert from "node:assert/strict";
import test from "node:test";

import { probeDsh, type CommandRunner } from "../../src/dsh/probe.ts";

test("reports an unavailable DSH CLI without treating it as a test failure", async () => {
  const runner: CommandRunner = async () => ({ exitCode: null, stdout: "", stderr: "", errorCode: "ENOENT" });
  assert.deepEqual(await probeDsh(runner), {
    status: "unavailable",
    command: "dsh",
    reason: "dsh executable was not found on PATH",
  });
});

test("reads a release-candidate version from dsh --version", async () => {
  const runner: CommandRunner = async (command, args) => {
    assert.equal(command, "dsh");
    assert.deepEqual(args, ["--version"]);
    return { exitCode: 0, stdout: "dsh 0.1.1-rc.2\n", stderr: "" };
  };

  assert.deepEqual(await probeDsh(runner), {
    status: "available",
    command: "dsh",
    version: "0.1.1-rc.2",
  });
});

test("reports malformed version output as a controlled diagnostic", async () => {
  const runner: CommandRunner = async () => ({ exitCode: 0, stdout: "DeepSeek Harness", stderr: "" });
  assert.deepEqual(await probeDsh(runner), {
    status: "unrecognized",
    command: "dsh",
    reason: "dsh --version did not contain a semantic version",
  });
});
