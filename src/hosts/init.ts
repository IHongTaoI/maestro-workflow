import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { atomicWriteJson } from "../runtime/atomic.ts";
import { installProjectSkill, verifyProjectSkill } from "../dsh/install-skill.ts";
import { projectStateRoot } from "../task-memory/paths.ts";

export const MAESTRO_HOSTS = ["dsh"] as const;
export type MaestroHost = (typeof MAESTRO_HOSTS)[number];

export type HostInstallation = {
  schemaVersion: 1;
  host: MaestroHost;
  runtime: "project-package";
  command: "npx --no-install maestro";
  installedAt: string;
  skillPath: string;
};

export async function initializeHost(options: {
  projectRoot: string;
  host: MaestroHost;
  sourceSkillRoot: string;
  force?: boolean;
  clock?: () => Date;
}): Promise<HostInstallation> {
  if (options.host !== "dsh") throw new Error(`unsupported Maestro host: ${String(options.host)}`);
  const skill = await installProjectSkill({
    projectRoot: options.projectRoot,
    sourceSkillRoot: options.sourceSkillRoot,
    ...(options.force ? { force: true } : {}),
  });
  for (const directory of ["memory", "wiki", "drafts", "locks"]) {
    await mkdir(resolve(projectStateRoot(options.projectRoot), directory), { recursive: true });
  }
  const installation: HostInstallation = {
    schemaVersion: 1,
    host: options.host,
    runtime: "project-package",
    command: "npx --no-install maestro",
    installedAt: (options.clock ?? (() => new Date()))().toISOString(),
    skillPath: skill.targetPath,
  };
  await atomicWriteJson(resolve(projectStateRoot(options.projectRoot), "host.json"), installation);
  return installation;
}

export async function verifyHostInstallation(options: {
  projectRoot: string;
  sourceSkillRoot: string;
}): Promise<{ status: "installed" | "missing" | "modified"; runtimeConfigured: boolean; skillPath: string }> {
  const skill = await verifyProjectSkill(options);
  let runtimeConfigured = false;
  try {
    const { readFile } = await import("node:fs/promises");
    const host = JSON.parse(await readFile(resolve(projectStateRoot(options.projectRoot), "host.json"), "utf8")) as Partial<HostInstallation>;
    runtimeConfigured = host.schemaVersion === 1 && host.host === "dsh" && host.command === "npx --no-install maestro";
  } catch {
    runtimeConfigured = false;
  }
  return { status: runtimeConfigured ? skill.status : "missing", runtimeConfigured, skillPath: skill.targetPath };
}
