import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { probeDsh, runCommand, type CommandRunner } from "../dsh/probe.ts";
import { createTemporaryDraft } from "../memory/three-layer-store.ts";
import { writeMemoryEntry, queryProjectMemory } from "../task-memory/memory-store.ts";
import { createWorkspace, loadWorkspace } from "../workspace/store.ts";
import { atomicWriteFile } from "./atomic.ts";
import { applyPermissions, CoreProtocolError } from "./core-protocol.ts";
import { TaskLockConflictError, withTaskLock } from "./task-lock.ts";

export type CapabilityProbe = {
  id: "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P07";
  name: string;
  status: "passed" | "failed";
  detail: string;
};

export type CapabilityProbeReport = {
  status: "passed" | "failed";
  probes: CapabilityProbe[];
};

async function probe(id: CapabilityProbe["id"], name: string, run: () => Promise<string>): Promise<CapabilityProbe> {
  try {
    return { id, name, status: "passed", detail: await run() };
  } catch (error) {
    return { id, name, status: "failed", detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function runCapabilityProbes(options: {
  sourceSkillRoot: string;
  dshRunner?: CommandRunner;
}): Promise<CapabilityProbeReport> {
  const root = await mkdtemp(join(tmpdir(), "maestro-v3-probe-"));
  try {
    const probes: CapabilityProbe[] = [];
    probes.push(await probe("P01", "atomic state write", async () => {
      const path = join(root, "atomic.json");
      await atomicWriteFile(path, "complete\n");
      if (await readFile(path, "utf8") !== "complete\n") throw new Error("atomic write mismatch");
      return "same-directory atomic replacement is available";
    }));
    probes.push(await probe("P02", "exclusive state lock", async () => {
      const lock = join(root, ".maestro", "locks", "probe.lock");
      let rejected = false;
      await withTaskLock(lock, async () => {
        try {
          await withTaskLock(lock, async () => undefined);
        } catch (error) {
          rejected = error instanceof TaskLockConflictError;
        }
      });
      if (!rejected) throw new Error("concurrent lock acquisition was not rejected");
      return "concurrent writers are rejected";
    }));
    probes.push(await probe("P03", "three-layer memory IO", async () => {
      await createTemporaryDraft({ projectRoot: root, id: "probe-draft", text: "unconfirmed" });
      await writeMemoryEntry({ projectRoot: root, entry: { schemaVersion: 1, id: "memory-probe-run-000001", taskId: "probe", runId: "run-000001", tags: ["probe"], text: "memory query evidence", sourceArtifactIds: [], createdAt: new Date().toISOString() } });
      const result = await queryProjectMemory({ projectRoot: root, queries: ["evidence"] });
      if (result.length !== 1) throw new Error("memory retrieval did not return the written entry");
      return "draft and durable task memory are readable";
    }));
    probes.push(await probe("P04", "default-deny protected paths", async () => {
      await createWorkspace({ projectRoot: root, workspaceId: "probe-workspace", identity: "Capability probe", mode: "lite", request: "Probe permissions." });
      let rejected = false;
      try {
        await applyPermissions({ projectRoot: root, workspaceId: "probe-workspace", role: "coder", write: [".agents/.local/work/probe-workspace/meta.json"] });
      } catch (error) {
        rejected = error instanceof CoreProtocolError;
      }
      if (!rejected) throw new Error("protected metadata path was writable");
      return "protected runtime paths remain denied";
    }));
    probes.push(await probe("P05", "complete role assets", async () => {
      for (const role of ["tpm", "laborer", "architect", "orchestrator", "coder", "test-designer", "test-runner", "delivery"]) {
        const content = await readFile(resolve(options.sourceSkillRoot, "roles", `${role}.md`), "utf8");
        if (!content.includes("JSON")) throw new Error(`role asset is incomplete: ${role}`);
      }
      return "all V3 role contracts are installed";
    }));
    probes.push(await probe("P06", "DSH executable contract", async () => {
      const result = await probeDsh(options.dshRunner ?? runCommand);
      if (result.status !== "available") throw new Error(result.reason);
      return `dsh ${result.version} is available`;
    }));
    probes.push(await probe("P07", "workspace-only recovery", async () => {
      const requestPath = join(root, "probe-request.md");
      await writeFile(requestPath, "recover from disk\n");
      const workspace = await loadWorkspace(root, "probe-workspace");
      if (workspace.identity !== "Capability probe" || workspace.currentStage !== "intake") throw new Error("workspace metadata could not be reconstructed");
      return "workspace state reloads without a session id";
    }));
    return { status: probes.every((item) => item.status === "passed") ? "passed" : "failed", probes };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
